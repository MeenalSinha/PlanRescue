import { toEpochMs } from '../lib/time.js';
import { MS_PER_MINUTE, compareText, type PlanningContext, type Slot } from './schedule.js';
import { STRATEGIES, type PlanChangeResult, type PlanScore, type RankingPreferences, type RecoveryPlan, type TaskFinding } from './types.js';

/**
 * Deterministic candidate scoring. A score is a PENALTY: lower is better. It orders candidates that
 * already satisfy every hard constraint; it is not a claim of optimality. Hard constraints sit outside
 * the arithmetic: ranking compares the hard-violation count first, so no soft preference can ever lift
 * a plan with a violation above one without.
 *
 *   total = 100 × changedEvents
 *         + Σ over moved events (shiftMinutes × priorityWeight)      priorityWeightedDelay
 *         + Σ over moved focus events (shiftMinutes)                  focusTime
 *         + transitionWeight × tightTransitions                       tightTransitions
 *         + 40 × (tasks at_risk) + 200 × (tasks infeasible)           taskRisk
 *
 *   priorityWeight:   critical 8, high 4, medium 2, low 1
 *   shiftMinutes:     |proposed start − original start|
 *   tight transition: two neighbouring events in the final schedule, at least one of which moved or is the
 *                     event that overran, with under 10 minutes between them (touching counts as 0)
 *   transitionWeight: 10 by default; 40 when preferences.optimizeFor = "transition_time"
 *
 * Ranking order: hard violations, total, number of changed events, strategy order, plan id.
 */
export const SCORE_WEIGHTS = {
  changedEvent: 100,
  priority: { critical: 8, high: 4, medium: 2, low: 1 },
  focusMinute: 1,
  tightGapMinutes: 10,
  tightTransition: { minimal_disruption: 10, transition_time: 40 },
  taskAtRisk: 40,
  taskInfeasible: 200,
} as const;

export const SCORE_FORMULA =
  'total (lower is better) = 100×changedEvents + Σ(shiftMinutes×priorityWeight[critical 8, high 4, medium 2, low 1]) + Σ(shiftMinutes of moved focus events) + transitionWeight×tightTransitions(neighbours <10 min apart, touching a moved or overrunning event; weight 10, or 40 with optimizeFor=transition_time) + 40×atRiskTasks + 200×infeasibleTasks. Ranking: hard violations first (any violation disqualifies), then total, then fewer changed events, then strategy order, then plan id. A heuristic ordering, not a proof of optimality.';

export function scorePlan(args: {
  ctx: PlanningContext;
  changes: readonly PlanChangeResult[];
  finalSlots: readonly Slot[];
  findings: readonly TaskFinding[];
  hardViolations: number;
  preferences?: RankingPreferences | undefined;
}): Omit<PlanScore, 'rank'> {
  const { ctx, changes, finalSlots, findings } = args;
  const mode = args.preferences?.optimizeFor ?? 'minimal_disruption';

  let priorityWeightedDelay = 0;
  let focusTime = 0;
  for (const change of changes) {
    const event = ctx.byId.get(change.eventId)!;
    const shift = Math.abs(toEpochMs(change.proposedStartTime) - toEpochMs(change.originalStartTime)) / MS_PER_MINUTE;
    priorityWeightedDelay += shift * SCORE_WEIGHTS.priority[event.priority];
    if (event.category === 'focus') focusTime += shift * SCORE_WEIGHTS.focusMinute;
  }

  const touched = new Set(changes.map((c) => c.eventId));
  if (ctx.disruption) touched.add(ctx.disruption.event.id);
  const ordered = [...finalSlots].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || compareText(a.id, b.id));
  let tight = 0;
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const left = ordered[i]!;
    const right = ordered[i + 1]!;
    if (!touched.has(left.id) && !touched.has(right.id)) continue;
    if ((right.startMs - left.endMs) / MS_PER_MINUTE < SCORE_WEIGHTS.tightGapMinutes) tight += 1;
  }

  const taskRisk =
    SCORE_WEIGHTS.taskAtRisk * findings.filter((f) => f.status === 'at_risk').length +
    SCORE_WEIGHTS.taskInfeasible * findings.filter((f) => f.status === 'infeasible').length;

  const components = {
    changedEvents: SCORE_WEIGHTS.changedEvent * changes.length,
    priorityWeightedDelay,
    focusTime,
    tightTransitions: SCORE_WEIGHTS.tightTransition[mode] * tight,
    taskRisk,
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  return { total, hardViolations: args.hardViolations, components, formula: SCORE_FORMULA };
}

/** A candidate whose score has been computed but which has not been ranked yet. */
export type UnrankedPlan = Omit<RecoveryPlan, 'score'> & { score: Omit<PlanScore, 'rank'> };

/** Sort candidates best-first and number them. Pure: returns new objects. */
export function rankPlans(plans: readonly UnrankedPlan[]): RecoveryPlan[] {
  return [...plans]
    .sort(
      (a, b) =>
        a.score.hardViolations - b.score.hardViolations ||
        a.score.total - b.score.total ||
        a.changes.length - b.changes.length ||
        STRATEGIES.indexOf(a.strategy) - STRATEGIES.indexOf(b.strategy) ||
        compareText(a.planId, b.planId),
    )
    .map((plan, index) => ({ ...plan, score: { ...plan.score, rank: index + 1 } }));
}
