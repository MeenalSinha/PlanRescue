import { RecoveryInputError } from '../lib/errors.js';
import { isoWithOffset, toEpochMs } from '../lib/time.js';
import type { ScheduleEvent, Task } from '../types.js';
import {
  buildPlanningContext,
  describeScenarioEvent,
  findOverlaps,
  minutesOf,
  pairKey,
  type PlanningContext,
  type Slot,
} from './schedule.js';
import { assessTaskFindings } from './taskCapacity.js';
import {
  CHECK_NAMES,
  type Check,
  type CheckName,
  type Finding,
  type RecoveryPlanPayload,
  type ValidationResult,
} from './types.js';

/**
 * Independent validation of a recovery plan.
 *
 * The validator trusts nothing in the submitted plan except its list of proposed changes and the
 * scenario inputs (interval, disruption, protected IDs). It re-reads the stored calendar and tasks,
 * rebuilds the projected schedule from scratch and re-runs every hard check. It never consults the
 * generator or its placement code, and it ignores any `validation` result the plan carries.
 *
 * Pure: it receives the stored events and tasks and returns a result; it writes nothing.
 */

export interface ValidationData {
  /** Stored calendar events overlapping the planning interval. */
  events: readonly ScheduleEvent[];
  tasks: readonly Task[];
}

export function validateRecoveryPlan(plan: RecoveryPlanPayload, data: ValidationData): ValidationResult {
  const checks: Check[] = [];
  const violations: Finding[] = [];
  const warnings: Finding[] = [];

  const ref = (eventId?: string, taskId?: string) => ({ eventId: eventId ?? null, taskId: taskId ?? null });
  const fail = (name: CheckName, message: string, eventId?: string, taskId?: string): void => {
    checks.push({ name, passed: false, severity: 'hard', ...ref(eventId, taskId), message });
    violations.push({ check: name, ...ref(eventId, taskId), message });
  };
  const warn = (name: CheckName, message: string, eventId?: string, taskId?: string): void => {
    checks.push({ name, passed: false, severity: 'warning', ...ref(eventId, taskId), message });
    warnings.push({ check: name, ...ref(eventId, taskId), message });
  };
  const finish = (taskAssessments: ValidationResult['taskAssessments'], summaryDetail?: string): ValidationResult => {
    // One passing entry for every hard check that found nothing wrong, so a reader can see what was verified.
    for (const name of CHECK_NAMES) {
      if (!violations.some((v) => v.check === name)) {
        checks.push({ name, passed: true, severity: 'hard', eventId: null, taskId: null, message: PASS_MESSAGES[name] });
      }
    }
    const isValid = violations.length === 0;
    const claimed = plan.validation?.isValid;
    if (claimed === true && !isValid) {
      const message = `The submitted plan claimed validation.isValid=true, but independent validation found ${violations.length} hard violation${violations.length === 1 ? '' : 's'}. The claim was ignored.`;
      checks.push({ name: 'consistency', passed: false, severity: 'warning', eventId: null, taskId: null, message });
      warnings.push({ check: 'consistency', eventId: null, taskId: null, message });
    }
    const summary = isValid
      ? `Plan is valid: every hard constraint holds in the independently reconstructed schedule${warnings.length ? `, with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.${summaryDetail ? ` ${summaryDetail}` : ''}`
      : `Plan is INVALID: ${violations.length} hard violation${violations.length === 1 ? '' : 's'}. ${violations
          .slice(0, 3)
          .map((v) => v.message)
          .join(' ')}${violations.length > 3 ? ` (and ${violations.length - 3} more)` : ''}`;
    return {
      ...(plan.planId !== undefined ? { planId: plan.planId } : {}),
      isValid,
      checks,
      violations,
      warnings,
      taskAssessments,
      summary,
    };
  };

  // --- Scenario: interval, disruption target, protected IDs ---------------------------------------
  let ctx: PlanningContext;
  try {
    ctx = buildPlanningContext({
      startTime: plan.startTime,
      endTime: plan.endTime,
      events: data.events,
      tasks: data.tasks,
      disruption: plan.disruption,
      protectedEventIds: plan.protectedEventIds,
    });
  } catch (error) {
    if (!(error instanceof RecoveryInputError)) throw error;
    const name: CheckName =
      error.code === 'invalid_interval' ? 'valid_time_range' : error.code === 'unknown_event' ? 'event_existence' : 'scope_validity';
    fail(name, error.message, error.code === 'unknown_event' ? plan.disruption?.eventId : undefined);
    return finish([], 'The schedule could not be reconstructed.');
  }
  for (const message of ctx.warnings.filter((m) => m.startsWith('Protected event'))) warn('scope_validity', message);

  const targetId = ctx.disruption!.event.id;

  // --- Per-change checks --------------------------------------------------------------------------
  const proposed = new Map<string, Slot>(); // changes that are individually well-formed, by event id
  const seen = new Set<string>();
  for (const change of plan.changes) {
    const id = change.eventId;
    if (seen.has(id)) {
      fail('consistency', `Event ${id} appears in more than one change; the plan contradicts itself.`, id);
      continue;
    }
    seen.add(id);

    const stored = ctx.byId.get(id);
    if (!stored) {
      fail(
        'event_existence',
        `Event ${id} is not in the calendar for the planning interval (it does not exist, or lies outside ${ctx.window.startTime} to ${ctx.window.endTime}).`,
        id,
      );
      continue;
    }
    const label = `${stored.title} (${id})`;

    // Rules about WHAT may change apply whether or not the new times are well-formed.
    if (!stored.movable) fail('immovable_events', `${label} is immovable (movable=false) and must not be rescheduled.`, id);
    if (stored.priority === 'critical') fail('critical_events', `${label} is critical and must stay at its original time.`, id);
    if (ctx.protectedIds.has(id)) fail('protected_events', `${label} is protected by the caller and must not be changed.`, id);
    if (id === targetId) {
      fail(
        'consistency',
        `${label} is the event that overran. Its overrun is modelled by the disruption and the event is observed, not rescheduled; it must not be listed as a change.`,
        id,
      );
    }

    // Time-range validity.
    const startOk = isoWithOffset.safeParse(change.proposedStartTime).success;
    const endOk = isoWithOffset.safeParse(change.proposedEndTime).success;
    if (!startOk || !endOk) {
      fail(
        'valid_time_range',
        `${label} has an invalid ${!startOk ? 'proposedStartTime' : 'proposedEndTime'}: it must be an ISO 8601 timestamp with an explicit UTC offset.`,
        id,
      );
      continue;
    }
    const startMs = toEpochMs(change.proposedStartTime);
    const endMs = toEpochMs(change.proposedEndTime);
    if (endMs <= startMs) {
      fail('valid_time_range', `${label} ends (${change.proposedEndTime}) at or before it starts (${change.proposedStartTime}).`, id);
      continue;
    }

    // Duration is taken from the stored event, never from the plan's own claims.
    const storedMs = toEpochMs(stored.endTime) - toEpochMs(stored.startTime);
    if (endMs - startMs !== storedMs) {
      fail(
        'duration_preservation',
        `${label} would change length from ${minutesOf(storedMs)} to ${minutesOf(endMs - startMs)} minutes; durations must be preserved.`,
        id,
      );
    }

    if (startMs < ctx.window.startMs || endMs > ctx.window.endMs) {
      fail(
        'scope_validity',
        `${label} is moved to ${change.proposedStartTime} – ${change.proposedEndTime}, outside the planning interval ${ctx.window.startTime} – ${ctx.window.endTime}.`,
        id,
      );
    }

    // The plan's claims about the original schedule must match the stored calendar.
    for (const [field, claimed, actualMs] of [
      ['originalStartTime', change.originalStartTime, toEpochMs(stored.startTime)],
      ['originalEndTime', change.originalEndTime, toEpochMs(stored.endTime)],
    ] as const) {
      if (claimed === undefined) continue;
      if (!isoWithOffset.safeParse(claimed).success || toEpochMs(claimed) !== actualMs) {
        fail('consistency', `${label}: the plan claims ${field} ${claimed}, but the stored calendar says ${field === 'originalStartTime' ? stored.startTime : stored.endTime}.`, id);
      }
    }
    if (change.title !== undefined && change.title !== stored.title) {
      warn('consistency', `${label}: the plan calls this event "${change.title}"; the stored title is "${stored.title}".`, id);
    }
    if (startMs === toEpochMs(stored.startTime) && endMs === toEpochMs(stored.endTime)) {
      warn('consistency', `${label} is listed as a change but its proposed times equal its stored times.`, id);
    }

    proposed.set(id, { id, startMs, endMs });
  }

  // --- Reconstruct the schedule and look for overlaps ---------------------------------------------
  const reconstructed: Slot[] = ctx.projected.map((slot) => proposed.get(slot.id) ?? slot);
  const baselineKeys = new Set(findOverlaps(ctx.baseline).map((p) => pairKey(p.a.id, p.b.id)));
  const slotById = new Map(reconstructed.map((slot) => [slot.id, slot]));
  for (const pair of findOverlaps(reconstructed)) {
    const a = ctx.byId.get(pair.a.id)!;
    const b = ctx.byId.get(pair.b.id)!;
    const untouched = !proposed.has(a.id) && !proposed.has(b.id) && a.id !== targetId && b.id !== targetId;
    const preExisting = baselineKeys.has(pairKey(a.id, b.id)) && untouched;
    fail(
      'no_overlaps',
      `${describeScenarioEvent(ctx, a, slotById.get(a.id)!)} overlaps ${describeScenarioEvent(ctx, b, slotById.get(b.id)!)} in the proposed schedule${preExisting ? ' (an overlap already present in the stored schedule that the plan leaves unresolved)' : ''}.`,
      a.id,
    );
  }

  // --- Deadline feasibility, with each problem attributed to its origin ---------------------------
  const findings = assessTaskFindings({
    tasks: ctx.tasks,
    planStartMs: ctx.window.startMs,
    horizonEndMs: ctx.window.endMs,
    baseline: ctx.baseline,
    overrun: { startMs: ctx.disruption!.originalEndMs, endMs: ctx.disruption!.projectedEndMs },
    final: reconstructed,
  });
  for (const finding of findings) {
    if (finding.status !== 'infeasible' && finding.status !== 'at_risk') continue;
    const verdict = finding.status === 'infeasible' ? 'cannot be met' : 'is at risk';
    const base = `Deadline for "${finding.title}" (${finding.deadline}) ${verdict} in the proposed schedule`;
    if (finding.origin === 'plan_introduced' && finding.status === 'infeasible') {
      fail('deadline_feasibility', `${base}, and the proposed moves cause this: it was ${finding.baselineStatus} before. ${finding.note}`, undefined, finding.taskId);
    } else if (finding.origin === 'plan_introduced') {
      warn('deadline_feasibility', `${base}; the proposed moves reduce the margin (it was ${finding.baselineStatus} before). ${finding.note}`, undefined, finding.taskId);
    } else {
      const why =
        finding.origin === 'pre_existing'
          ? 'this was already the case in the stored schedule'
          : 'this follows from the overrun itself, not from the proposed moves';
      warn('deadline_feasibility', `${base}; ${why}. ${finding.note}`, undefined, finding.taskId);
    }
  }

  const moved = proposed.size;
  const detail = `Re-checked ${plan.changes.length} proposed change${plan.changes.length === 1 ? '' : 's'} against ${ctx.events.length} stored event${ctx.events.length === 1 ? '' : 's'} and ${findings.filter((f) => f.status !== 'not_assessed').length} task deadline${findings.filter((f) => f.status !== 'not_assessed').length === 1 ? '' : 's'}${moved === plan.changes.length ? '' : ' (some changes could not be applied)'}.`;
  return finish(findings, detail);
}

const PASS_MESSAGES: Record<CheckName, string> = {
  event_existence: 'Every referenced event exists in the calendar for the planning interval.',
  valid_time_range: 'The planning interval and every proposed time range are valid, with explicit UTC offsets and end after start.',
  no_overlaps: 'The reconstructed schedule has no overlapping events (half-open intervals).',
  duration_preservation: 'Every moved event keeps its original duration.',
  immovable_events: 'No immovable event is rescheduled.',
  critical_events: 'No critical event is rescheduled.',
  protected_events: 'No caller-protected event is changed.',
  deadline_feasibility: 'The plan introduces no task-deadline infeasibility.',
  scope_validity: 'All changes fall inside the planning interval and reference supported scenario inputs.',
  consistency: 'The plan\u2019s claims, change list and reconstructed schedule agree.',
};
