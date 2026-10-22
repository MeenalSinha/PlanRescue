import { createHash } from 'node:crypto';
import { clockTime, isoAtOffsetOf, overlaps, toEpochMs } from '../lib/time.js';
import {
  buildPlacementProblem,
  findFixedConflicts,
  placeFlexibleEvents,
  type PlacementOrder,
  type PlacementOutcome,
} from './placement.js';
import {
  buildPlanningContext,
  compareText,
  describeScenarioEvent,
  describeSlot,
  fixedReasons,
  minutesOf,
  type PlanningContext,
  type PlanningInput,
  type Slot,
} from './schedule.js';
import { rankPlans, SCORE_FORMULA, scorePlan, type UnrankedPlan } from './scoring.js';
import { validateRecoveryPlan } from './validateRecoveryPlan.js';
import type {
  Disruption,
  PlanChangeResult,
  RankingPreferences,
  RecoveryPlan,
  RecoveryPlanSet,
  Strategy,
  ValidationResult,
} from './types.js';

export interface PlanRequest extends PlanningInput {
  disruption: Disruption;
  preferences?: RankingPreferences | undefined;
}

interface StrategyDefinition {
  strategy: Strategy;
  order: PlacementOrder;
  /** Buffer sizes to try, largest preferred; the first that yields a placement is used. */
  buffers: readonly number[];
  description: string;
}

/**
 * Strategies, in the fixed order they are tried (and used as a ranking tie-breaker).
 * All three obey the same hard rules; they differ only in how flexible events are ordered and spaced.
 */
const STRATEGY_DEFINITIONS: readonly StrategyDefinition[] = [
  {
    strategy: 'minimal_disruption',
    order: 'chronological',
    buffers: [0],
    description: 'Working through the day in order, moves only events that overlap something, each to its earliest free slot.',
  },
  {
    strategy: 'buffered_transitions',
    order: 'chronological',
    buffers: [10, 5],
    description: 'Like minimal_disruption, but every moved event keeps a 10-minute (or failing that 5-minute) gap on each side, trading a little extra delay for breathing room.',
  },
  {
    strategy: 'priority_first',
    order: 'priority',
    buffers: [0],
    description: 'Lets higher-priority events keep their original slots where possible and pushes lower-priority events later instead.',
  },
];

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Deterministic, content-derived identifier: the same candidate always gets the same ID. */
function derivePlanId(args: {
  strategy: Strategy;
  startTime: string;
  endTime: string;
  disruption: Disruption;
  protectedEventIds: readonly string[];
  changes: readonly PlanChangeResult[];
}): string {
  const canonical = JSON.stringify([
    args.strategy,
    toEpochMs(args.startTime),
    toEpochMs(args.endTime),
    args.disruption.eventId,
    args.disruption.overrunMinutes,
    [...args.protectedEventIds],
    args.changes.map((c) => [c.eventId, toEpochMs(c.proposedStartTime), toEpochMs(c.proposedEndTime)]),
  ]);
  return `plan-${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}

function changeSetKey(changes: readonly PlanChangeResult[]): string {
  return changes.map((c) => `${c.eventId}@${toEpochMs(c.proposedStartTime)}-${toEpochMs(c.proposedEndTime)}`).join(',');
}

/** Turn a placement into the plan's change list, ordered by original start then id. */
function buildChanges(ctx: PlanningContext, outcome: PlacementOutcome): PlanChangeResult[] {
  const movedIds = new Set(outcome.moved.map((m) => m.id));
  const disruption = ctx.disruption!;
  const labelBlocker = (id: string): string => {
    const event = ctx.byId.get(id)!;
    if (id === disruption.event.id) {
      return `${event.title} (running until ${clockTime(disruption.projectedEndTime)} after the ${disruption.spec.overrunMinutes}-minute overrun)`;
    }
    return movedIds.has(id) ? `${event.title} (itself rescheduled in this plan)` : event.title;
  };

  return outcome.moved
    .map((placement): PlanChangeResult => {
      const event = ctx.byId.get(placement.id)!;
      const originalStart = toEpochMs(event.startTime);
      const originalEnd = toEpochMs(event.endTime);
      const delay = minutesOf(placement.startMs - originalStart);
      return {
        eventId: event.id,
        title: event.title,
        originalStartTime: event.startTime,
        originalEndTime: event.endTime,
        proposedStartTime: isoAtOffsetOf(event.startTime, placement.startMs),
        proposedEndTime: isoAtOffsetOf(event.endTime, placement.endMs),
        reason:
          `Moved ${describeSlot(event, originalStart, originalEnd)} → ${describeSlot(event, placement.startMs, placement.endMs)} ` +
          `(${delay >= 0 ? '+' : ''}${delay} min): its original slot overlapped ${placement.blockedBy.map(labelBlocker).join(' and ')}.`,
      };
    })
    .sort((a, b) => toEpochMs(a.originalStartTime) - toEpochMs(b.originalStartTime) || compareText(a.eventId, b.eventId));
}

function explain(args: {
  ctx: PlanningContext;
  def: StrategyDefinition;
  bufferMinutes: number;
  changes: readonly PlanChangeResult[];
  finalSlots: readonly Slot[];
  validation: ValidationResult;
}): Pick<RecoveryPlan, 'summary' | 'explanation'> {
  const { ctx, def, bufferMinutes, changes, finalSlots, validation } = args;
  const disruption = ctx.disruption!;
  const source = disruption.event;
  const movedIds = new Set(changes.map((c) => c.eventId));
  const fixed = ctx.events.filter((e) => fixedReasons(e, ctx.protectedIds, source.id).length > 0 && e.id !== source.id);
  const untouched = ctx.events.filter((e) => e.id !== source.id && !movedIds.has(e.id) && !fixed.includes(e));
  const totalDelay = changes.reduce((sum, c) => sum + minutesOf(toEpochMs(c.proposedStartTime) - toEpochMs(c.originalStartTime)), 0);
  const overrunText = `${source.title} running ${disruption.spec.overrunMinutes} minutes late (until ${clockTime(disruption.projectedEndTime)})`;

  const summary =
    changes.length === 0
      ? `No rescheduling needed: ${overrunText} does not overlap or displace any other event.`
      : `${def.strategy.replace('_', ' ')}: absorbs ${overrunText} by moving ${plural(changes.length, 'event')} (${changes
          .map((c) => c.title)
          .join(', ')}) later by ${totalDelay} minutes in total, keeping every duration and leaving ${
          fixed.length > 0 ? fixed.map((e) => e.title).join(', ') : 'all fixed events'
        } unchanged.`;

  // Slack before the next event, for each moved event: a derived, honest limitation.
  const ordered = [...finalSlots].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || compareText(a.id, b.id));
  const tightNotes: string[] = [];
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const left = ordered[i]!;
    const right = ordered[i + 1]!;
    if (!movedIds.has(left.id) && !movedIds.has(right.id) && left.id !== source.id && right.id !== source.id) continue;
    const gap = minutesOf(right.startMs - left.endMs);
    if (gap < 10) {
      const [l, r] = [ctx.byId.get(left.id)!.title, ctx.byId.get(right.id)!.title];
      tightNotes.push(gap <= 0 ? `${l} runs straight into ${r} with no gap.` : `Only ${plural(gap, 'minute')} separate${gap === 1 ? 's' : ''} ${l} and ${r}.`);
    }
  }

  const newOverlaps = describeNewOverlaps(ctx);
  const assessed = validation.taskAssessments.filter((t) => t.status !== 'not_assessed');
  const trouble = assessed.filter((t) => t.status === 'at_risk' || t.status === 'infeasible');

  return {
    summary,
    explanation: {
      changes:
        changes.length === 0
          ? ['No events move.']
          : changes.map((c) => `${c.title}: ${clockTime(c.originalStartTime)}–${clockTime(c.originalEndTime)} → ${clockTime(c.proposedStartTime)}–${clockTime(c.proposedEndTime)}.`),
      unchanged: [
        ...(fixed.length > 0
          ? [`Protected or fixed events stay exactly where they are: ${fixed.map((e) => `${e.title} (${describeSlot(e, toEpochMs(e.startTime), toEpochMs(e.endTime))})`).join(', ')}.`]
          : []),
        `${source.title} keeps its start; only its end moves, as an observed overrun that is not rescheduled.`,
        ...(untouched.length > 0 ? [`Events with no conflict are untouched: ${untouched.map((e) => e.title).join(', ')}.`] : []),
      ],
      rationale: [
        newOverlaps.length === 0
          ? `The overrun creates no new overlap, so nothing has to move.`
          : `The overrun creates ${plural(newOverlaps.length, 'new overlap')}: ${newOverlaps.join('; ')}.`,
        `Strategy: ${def.description}${bufferMinutes > 0 ? ` Buffer used: ${bufferMinutes} minutes.` : ''}`,
        'Every moved event keeps its original duration and starts no earlier than it originally did; the reconstructed schedule has no overlaps.',
      ],
      taskCapacity: [
        assessed.length === 0
          ? 'No unfinished task has a deadline inside the planning interval, so no capacity finding applies.'
          : `${assessed.length - trouble.length} of ${assessed.length} assessed deadline${assessed.length === 1 ? '' : 's'} ${assessed.length - trouble.length === 1 ? 'has' : 'have'} enough unoccupied calendar time (a capacity estimate, not a confirmed slot).`,
        ...trouble.map((t) => `"${t.title}" is ${t.status === 'infeasible' ? 'infeasible' : 'at risk'} (${t.origin.replace('_', '-')}): ${t.note}`),
        'Task effort is not scheduled into slots, and a feasible capacity estimate does not mean any task has been completed.',
      ],
      limitations: [
        ...tightNotes,
        'This is a proposal only; nothing has been written to the calendar.',
        'Capacity counts only unoccupied time and treats each task\u2019s estimate as fully remaining effort; focus and deadline-work blocks are not counted as capacity.',
        'Events are only ever moved later, never earlier, and the heuristic does not prove that it minimises moves or delay.',
      ],
    },
  };
}

/** Plain-language list of the overlaps the overrun creates (compared with the stored schedule). */
function describeNewOverlaps(ctx: PlanningContext): string[] {
  const source = ctx.disruption!;
  const slotById = new Map(ctx.projected.map((s) => [s.id, s]));
  const out: string[] = [];
  for (const event of ctx.events) {
    if (event.id === source.event.id) continue;
    const slot = slotById.get(event.id)!;
    if (overlaps(slot.startMs, slot.endMs, source.originalEndMs, source.projectedEndMs)) {
      out.push(`${describeScenarioEvent(ctx, event, slot)} now overlaps ${source.event.title}`);
    }
  }
  return out;
}

/**
 * Generate recovery candidates for an event overrun.
 *
 * Each strategy produces a candidate by placing flexible events around fixed ones; every candidate is
 * then handed to validateRecoveryPlan as a plain payload, exactly as an external caller would submit
 * it, and only candidates that the validator accepts are returned. The generator and validator share
 * no placement code, so a bug in one is not silently accepted by the other.
 *
 * Pure and deterministic: no randomness, no clock, no I/O. Throws RecoveryInputError for requests that
 * cannot be analysed.
 */
export function generateRecoveryPlans(input: PlanRequest): RecoveryPlanSet {
  const ctx = buildPlanningContext(input);
  const disruption = ctx.disruption!.spec;
  const protectedEventIds = [...ctx.protectedIds].sort(compareText);
  const interval = { startTime: ctx.window.startTime, endTime: ctx.window.endTime };
  const base = {
    interval,
    disruption,
    protectedEventIds,
    rankingFormula: SCORE_FORMULA,
    warnings: [...ctx.warnings],
  };

  const problem = buildPlacementProblem(ctx);

  // Events that cannot move but still overlap cannot be fixed by any rescheduling.
  const fixedConflicts = findFixedConflicts(problem);
  if (fixedConflicts.length > 0) {
    const slotById = new Map(ctx.projected.map((s) => [s.id, s]));
    const reasons = fixedConflicts.map((pair) => {
      const a = ctx.byId.get(pair.a.id)!;
      const b = ctx.byId.get(pair.b.id)!;
      const why = (e: typeof a): string => fixedReasons(e, ctx.protectedIds, disruption.eventId).join('/').replace(/_/g, ' ');
      return {
        code: 'fixed_conflict' as const,
        eventIds: [a.id, b.id],
        message: `${describeScenarioEvent(ctx, a, slotById.get(a.id)!)} [${why(a)}] overlaps ${describeScenarioEvent(ctx, b, slotById.get(b.id)!)} [${why(b)}]. Neither can be rescheduled, so no recovery plan can satisfy the hard constraints.`,
      };
    });
    return {
      ...base,
      outcome: 'infeasible',
      candidates: [],
      discardedStrategies: STRATEGY_DEFINITIONS.map((d) => ({ strategy: d.strategy, reason: 'Not attempted: events that cannot be moved overlap each other.' })),
      infeasibility: {
        reasons,
        summary: `No feasible plan: the hard constraints cannot all be satisfied. ${reasons.map((r) => r.message).join(' ')} Relax a constraint yourself (for example, remove a protected ID or decide which fixed commitment gives way); the planner will not do it silently.`,
      },
      summary: `No feasible recovery plan: ${plural(reasons.length, 'fixed-event conflict')} cannot be resolved without moving something that must not move.`,
    };
  }

  const scored: UnrankedPlan[] = [];
  const discarded: RecoveryPlanSet['discardedStrategies'] = [];
  const failures: NonNullable<RecoveryPlanSet['infeasibility']>['reasons'] = [];
  const seenKeys = new Map<string, Strategy>();

  for (const def of STRATEGY_DEFINITIONS) {
    let outcome: PlacementOutcome | undefined;
    let usedBuffer = 0;
    let lastFailure: PlacementOutcome['failure'];
    for (const buffer of def.buffers) {
      const attempt = placeFlexibleEvents(problem, { order: def.order, bufferMinutes: buffer });
      if (!attempt.failure) {
        outcome = attempt;
        usedBuffer = buffer;
        break;
      }
      lastFailure = attempt.failure;
    }
    if (!outcome) {
      const failure = lastFailure!;
      const tried = def.buffers.length > 1 ? ` Buffers of ${def.buffers.join(' and ')} minutes were each tried. Last attempt:` : '';
      discarded.push({ strategy: def.strategy, reason: `No valid placement.${tried} ${failure.reason}`.replace(/\s+/g, ' ') });
      failures.push({ code: 'no_slot', eventIds: [failure.eventId], message: `${def.strategy}: ${failure.reason}` });
      continue;
    }

    const changes = buildChanges(ctx, outcome);
    const key = changeSetKey(changes);
    const duplicateOf = seenKeys.get(key);
    if (duplicateOf) {
      discarded.push({ strategy: def.strategy, reason: `Produces exactly the same changes as ${duplicateOf}, so it is not a distinct alternative.` });
      continue;
    }

    const planId = derivePlanId({ strategy: def.strategy, ...interval, disruption, protectedEventIds, changes });
    // The same entry point an external caller uses: the candidate goes through the independent validator.
    const validation = validateRecoveryPlan(
      { planId, ...interval, disruption, protectedEventIds, changes },
      { events: input.events, tasks: input.tasks },
    );
    if (!validation.isValid) {
      discarded.push({ strategy: def.strategy, reason: `Failed independent validation: ${validation.violations.map((v) => v.message).join(' ')}` });
      failures.push({
        code: 'validation_failed',
        eventIds: [...new Set(validation.violations.flatMap((v) => (v.eventId ? [v.eventId] : [])))],
        message: `${def.strategy}: ${validation.violations.map((v) => v.message).join(' ')}`,
      });
      continue;
    }
    seenKeys.set(key, def.strategy);

    const movedById = new Map(outcome.moved.map((m) => [m.id, m]));
    const finalSlots: Slot[] = ctx.projected.map((slot) => {
      const moved = movedById.get(slot.id);
      return moved ? { id: slot.id, startMs: moved.startMs, endMs: moved.endMs } : slot;
    });
    const { summary, explanation } = explain({ ctx, def, bufferMinutes: usedBuffer, changes, finalSlots, validation });
    const unchangedProtectedEvents = ctx.events
      .map((event) => ({ event, reasons: fixedReasons(event, ctx.protectedIds, disruption.eventId) }))
      .filter(({ event, reasons }) => reasons.length > 0 && !movedById.has(event.id))
      .map(({ event, reasons }) => ({
        eventId: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        priority: event.priority,
        reasons,
      }));

    scored.push({
      planId,
      strategy: def.strategy,
      summary,
      ...interval,
      protectedEventIds,
      disruption,
      changes,
      unchangedProtectedEvents,
      taskAssessments: validation.taskAssessments,
      explanation,
      score: scorePlan({
        ctx,
        changes,
        finalSlots,
        findings: validation.taskAssessments,
        hardViolations: validation.violations.length,
        preferences: input.preferences,
      }),
      validation,
    });
  }

  const candidates = rankPlans(scored);
  if (candidates.length === 0) {
    const summary = `No feasible plan: ${failures.map((f) => f.message).join(' ')}`;
    return {
      ...base,
      outcome: 'infeasible',
      candidates: [],
      discardedStrategies: discarded,
      infeasibility: { reasons: failures, summary },
      summary: `No feasible recovery plan: every strategy was rejected. ${failures[0]?.message ?? ''}`.trim(),
    };
  }

  const best = candidates[0]!;
  const noChange = best.changes.length === 0;
  return {
    ...base,
    outcome: noChange ? 'no_changes_needed' : 'plans_found',
    candidates,
    discardedStrategies: discarded,
    infeasibility: null,
    summary: noChange
      ? best.summary
      : `${plural(candidates.length, 'validated candidate')}. Recommended (rank 1, score ${best.score.total}, lower is better): ${best.strategy} (${best.planId}). ${best.summary}`,
  };
}
