import { isoAtOffsetOf, overlaps, toEpochMs } from '../lib/time.js';
import type { ScheduleEvent } from '../types.js';
import {
  buildPlanningContext,
  compareText,
  describeScenarioEvent,
  findOverlaps,
  fixedReasons,
  minutesOf,
  MS_PER_MINUTE,
  pairKey,
  priorityRank,
  type OverlapPair,
  type PlanningInput,
} from './schedule.js';
import { buildPlacementProblem, placeFlexibleEvents } from './placement.js';
import { assessTaskFindings } from './taskCapacity.js';
import type { Conflict, ConflictAnalysis, Severity, TaskFinding } from './types.js';

/** The more important of two events sets the severity of a conflict between them. */
function overlapSeverity(a: ScheduleEvent, b: ScheduleEvent): Severity {
  return priorityRank(a.priority) <= priorityRank(b.priority) ? a.priority : b.priority;
}

function taskSeverity(finding: TaskFinding): Severity {
  if (finding.status === 'infeasible') return finding.priority === 'critical' ? 'critical' : 'high';
  return finding.priority === 'critical' || finding.priority === 'high' ? 'medium' : 'low';
}

/**
 * Analyse the stored schedule and, optionally, the projected schedule after an event overrun.
 *
 * Pure: it receives events and tasks and returns findings. The disruption is applied to an in-memory
 * copy only. Throws RecoveryInputError for a request that cannot be analysed (bad interval, unknown
 * disruption event).
 */
export function analyzeConflicts(input: PlanningInput): ConflictAnalysis {
  const ctx = buildPlanningContext(input);
  const disruptedId = ctx.disruption?.event.id;
  const unfinishedTasks = ctx.tasks.filter((task) => task.status !== 'completed');

  // --- Which events can the planner move at all, and could a minimal rescheduling place them? ------
  const problem = buildPlacementProblem(ctx);
  const attempt = placeFlexibleEvents(problem, { order: 'chronological', bufferMinutes: 0 });
  const movedIds = new Set(attempt.moved.map((m) => m.id));
  const failedId = attempt.failure?.eventId;
  const canMove = (event: ScheduleEvent): boolean => fixedReasons(event, ctx.protectedIds, disruptedId).length === 0;

  // --- Task capacity under the stored and the disrupted schedule ----------------------------------
  const findings = assessTaskFindings({
    tasks: ctx.tasks,
    planStartMs: ctx.window.startMs,
    horizonEndMs: ctx.window.endMs,
    baseline: ctx.baseline,
    overrun: ctx.disruption ? { startMs: ctx.disruption.originalEndMs, endMs: ctx.disruption.projectedEndMs } : undefined,
  });

  // --- Event overlaps -----------------------------------------------------------------------------
  const baselinePairs = findOverlaps(ctx.baseline);
  const projectedPairs = findOverlaps(ctx.projected);
  const baselineKeys = new Set(baselinePairs.map((p) => pairKey(p.a.id, p.b.id)));
  const slotById = new Map(ctx.projected.map((slot) => [slot.id, slot]));

  const overlapConflict = (pair: OverlapPair, introducedByDisruption: boolean): Conflict => {
    const eventA = ctx.byId.get(pair.a.id)!;
    const eventB = ctx.byId.get(pair.b.id)!;
    const movable = [eventA, eventB].filter(canMove);
    const stuck = movable.some((e) => e.id === failedId);
    const resolvable = movable.length > 0 && !stuck;
    const from = isoAtOffsetOf(eventA.startTime, pair.startMs);
    const to = isoAtOffsetOf(eventA.startTime, pair.endMs);
    const minutes = minutesOf(pair.endMs - pair.startMs);

    let nextStep: string;
    if (movable.length === 0) {
      nextStep = `${eventA.title} and ${eventB.title} cannot be moved by the planner (immovable, critical, protected or the overrunning event). One of them needs a manual decision.`;
    } else if (stuck) {
      nextStep = `The planner cannot find a slot for ${attempt.failure ? ctx.byId.get(attempt.failure.eventId)?.title : 'a movable event'} inside the planning interval. ${attempt.failure?.reason ?? ''}`.trim();
    } else {
      nextStep = `Reschedule ${movable.map((e) => e.title).join(' or ')} (movable); run propose_recovery_plan for validated options.`;
    }
    return {
      issueId: `overlap:${pairKey(pair.a.id, pair.b.id)}`,
      category: 'event_overlap',
      severity: overlapSeverity(eventA, eventB),
      affectedEventIds: [pair.a.id, pair.b.id],
      affectedTaskIds: [],
      description:
        `${describeScenarioEvent(ctx, eventA, slotById.get(eventA.id)!)} overlaps ` +
        `${describeScenarioEvent(ctx, eventB, slotById.get(eventB.id)!)} for ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      interval: { startTime: from, endTime: to },
      introducedByDisruption,
      resolvable,
      suggestedNextStep: nextStep,
    };
  };

  const existingConflicts: Conflict[] = baselinePairs.map((p) => overlapConflict(p, false));
  const newConflicts: Conflict[] = projectedPairs
    .filter((p) => !baselineKeys.has(pairKey(p.a.id, p.b.id)))
    .map((p) => overlapConflict(p, true));

  // --- Deadline conflicts: only genuine capacity problems, never mere proximity -------------------
  const flexibleMinutesBefore = (deadlineMs: number): number =>
    ctx.events
      .filter(canMove)
      .reduce(
        (sum, event) => {
          const slot = slotById.get(event.id)!;
          const start = Math.max(slot.startMs, ctx.window.startMs);
          const end = Math.min(slot.endMs, deadlineMs);
          return sum + Math.max(0, end - start) / MS_PER_MINUTE;
        },
        0,
      );
  for (const finding of findings) {
    if (finding.status !== 'at_risk' && finding.status !== 'infeasible') continue;
    const deadlineMs = toEpochMs(finding.deadline);
    const shortfall = finding.slackMinutes !== null && finding.slackMinutes < 0 ? -finding.slackMinutes : 0;
    const resolvable = finding.status === 'at_risk' ? true : flexibleMinutesBefore(deadlineMs) >= shortfall && shortfall > 0;
    const conflict: Conflict = {
      issueId: `deadline:${finding.taskId}`,
      category: 'task_deadline',
      severity: taskSeverity(finding),
      affectedEventIds: [],
      affectedTaskIds: [finding.taskId],
      description:
        finding.status === 'infeasible'
          ? `Deadline for "${finding.title}" (${finding.deadline}) cannot be met under capacity assumptions. ${finding.note}`
          : `Deadline for "${finding.title}" (${finding.deadline}) is at risk. ${finding.note}`,
      interval: { startTime: ctx.window.startTime, endTime: finding.deadline },
      introducedByDisruption: finding.origin === 'disruption',
      resolvable,
      suggestedNextStep:
        finding.status === 'infeasible'
          ? resolvable
            ? 'Moving flexible events past the deadline could free enough time; consider this before accepting a plan.'
            : 'Not enough movable time exists before the deadline. The deadline or the task effort needs a manual decision.'
          : 'Keep further disruption away from the time before this deadline.',
    };
    (finding.origin === 'disruption' ? newConflicts : existingConflicts).push(conflict);
  }

  // --- Affected events ----------------------------------------------------------------------------
  const affected: ConflictAnalysis['affectedEvents'] = [];
  if (ctx.disruption) {
    const { event: source, originalEndMs, projectedEndMs } = ctx.disruption;
    for (const event of ctx.events) {
      if (event.id === source.id) continue;
      const slot = slotById.get(event.id)!;
      const direct = overlaps(slot.startMs, slot.endMs, originalEndMs, projectedEndMs);
      if (direct) {
        affected.push({
          eventId: event.id,
          title: event.title,
          impact: 'direct_overlap',
          canBeRescheduled: canMove(event),
          reason: `Overlaps the extra ${ctx.disruption.spec.overrunMinutes} minutes ${source.title} now occupies (until ${ctx.disruption.projectedEndTime}).`,
        });
      } else if (movedIds.has(event.id)) {
        affected.push({
          eventId: event.id,
          title: event.title,
          impact: 'cascade',
          canBeRescheduled: true,
          reason: 'Not touched by the overrun directly, but would be displaced by events that must move.',
        });
      }
    }
  } else {
    const involved = new Set(baselinePairs.flatMap((p) => [p.a.id, p.b.id]));
    for (const event of ctx.events) {
      if (!involved.has(event.id)) continue;
      affected.push({
        eventId: event.id,
        title: event.title,
        impact: 'existing_conflict',
        canBeRescheduled: canMove(event),
        reason: 'Overlaps another event in the stored schedule.',
      });
    }
  }
  affected.sort((a, b) => compareText(a.eventId, b.eventId));

  // --- Protected constraints ----------------------------------------------------------------------
  const protectedConstraints = ctx.events
    .map((event) => ({ event, reasons: fixedReasons(event, ctx.protectedIds, disruptedId) }))
    .filter((entry) => entry.reasons.length > 0)
    .map(({ event, reasons }) => ({
      eventId: event.id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      priority: event.priority,
      reasons,
    }));

  // --- Overall assessment -------------------------------------------------------------------------
  const all = [...existingConflicts, ...newConflicts];
  const unresolvable = all.filter((c) => !c.resolvable);
  const status = all.length === 0 ? 'no_conflicts' : unresolvable.length > 0 ? 'conflicts_unresolvable' : 'conflicts_resolvable';
  const scope = ctx.disruption
    ? `${ctx.disruption.event.title} running ${ctx.disruption.spec.overrunMinutes} minutes late (until ${ctx.disruption.projectedEndTime})`
    : 'the stored schedule';
  const summary =
    status === 'no_conflicts'
      ? `No conflicts found for ${scope} across ${ctx.events.length} event${ctx.events.length === 1 ? '' : 's'}.`
      : `${all.length} conflict${all.length === 1 ? '' : 's'} found for ${scope}: ${existingConflicts.length} existing, ${newConflicts.length} new. ` +
        (unresolvable.length > 0
          ? `${unresolvable.length} appear${unresolvable.length === 1 ? 's' : ''} unresolvable under the current constraints.`
          : 'All appear resolvable under the current constraints; run propose_recovery_plan for validated options.');

  return {
    interval: { startTime: ctx.window.startTime, endTime: ctx.window.endTime },
    disruption: ctx.disruption ? { ...ctx.disruption.spec } : null,
    eventsExamined: ctx.events.length,
    tasksExamined: unfinishedTasks.length,
    existingConflicts,
    newConflicts,
    affectedEvents: affected,
    protectedConstraints,
    taskAssessments: findings,
    warnings: [...ctx.warnings],
    assessment: { status, summary },
  };
}
