import * as z from 'zod/v4';
import { isoWithOffset } from '../lib/time.js';
import { PRIORITIES } from '../types.js';

/**
 * Types and schemas shared by the Recovery Engine and the three recovery MCP tools.
 * Schemas are defined once here; the engine's TypeScript types are inferred from them so a tool's
 * advertised schema and the engine's actual contract cannot drift apart.
 */

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Upper bound on a reported overrun: four hours. */
export const MAX_OVERRUN_MINUTES = 240;
export const MAX_PROTECTED_EVENT_IDS = 100;
export const MAX_PLAN_CHANGES = 200;
/** Longest planning interval accepted, to keep every request cheap and bounded. */
export const MAX_PLANNING_WINDOW_DAYS = 14;
/** Most calendar events considered in one request. */
export const MAX_EVENTS_PER_REQUEST = 500;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export const eventIdSchema = z.string().min(1).max(128);

/** The one supported disruption: an event ran longer than scheduled. Its start is unchanged. */
export const disruptionSchema = z.object({
  type: z.literal('event_overrun').describe('Kind of disruption. Only "event_overrun" is supported.'),
  eventId: eventIdSchema.describe('ID of the calendar event that ran late (see get_schedule)'),
  overrunMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_OVERRUN_MINUTES)
    .describe(`How many minutes longer than scheduled the event actually ran: a whole number from 1 to ${MAX_OVERRUN_MINUTES}`),
});
export type Disruption = z.infer<typeof disruptionSchema>;

export const protectedEventIdsSchema = z
  .array(eventIdSchema)
  .max(MAX_PROTECTED_EVENT_IDS)
  .describe(
    'Additional event IDs that must not be rescheduled, on top of events that are already immovable or critical. IDs not found in the planning interval are ignored with a warning.',
  );

export const RANKING_PREFERENCES = ['minimal_disruption', 'transition_time'] as const;
export const rankingPreferencesSchema = z.object({
  optimizeFor: z
    .enum(RANKING_PREFERENCES)
    .optional()
    .describe(
      'Ranking preference. "minimal_disruption" (default) weighs back-to-back transitions lightly; "transition_time" weighs them heavily, so plans with breathing room between events rank higher. Hard constraints are never affected.',
    ),
});
export type RankingPreferences = z.infer<typeof rankingPreferencesSchema>;

// ---------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------

export const severitySchema = z.enum(PRIORITIES);
export type Severity = z.infer<typeof severitySchema>;

export const intervalSchema = z.object({
  startTime: z.string().describe('ISO 8601 start with explicit UTC offset (inclusive)'),
  endTime: z.string().describe('ISO 8601 end with explicit UTC offset (exclusive)'),
});

// ---------------------------------------------------------------------------------------------
// Task capacity
// ---------------------------------------------------------------------------------------------

export const CAPACITY_STATUSES = ['feasible', 'at_risk', 'infeasible', 'not_assessed'] as const;
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number];

/** Where a deadline problem comes from, so pre-existing trouble is never blamed on the disruption or the plan. */
export const RISK_ORIGINS = ['none', 'pre_existing', 'disruption', 'plan_introduced'] as const;
export type RiskOrigin = (typeof RISK_ORIGINS)[number];

export const taskFindingSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string().describe('Task deadline as stored, ISO 8601 with offset'),
  priority: severitySchema,
  estimatedDurationMinutes: z.number().int().positive().describe('Remaining effort assumed for the task'),
  status: z
    .enum(CAPACITY_STATUSES)
    .describe(
      'Aggregate capacity verdict in the analysed schedule: feasible (enough free time with margin), at_risk (enough free time but a margin of 30 minutes or less), infeasible (not enough free time before the deadline), not_assessed (deadline lies beyond the planning interval). This is a capacity estimate, not a task assignment.',
    ),
  baselineStatus: z.enum(CAPACITY_STATUSES).describe('Verdict for the stored schedule with no disruption'),
  origin: z
    .enum(RISK_ORIGINS)
    .describe(
      'For at_risk/infeasible tasks: pre_existing (already so before the disruption), disruption (caused by the overrun itself, not by rescheduling) or plan_introduced (caused by the proposed changes). none when feasible or not assessed.',
    ),
  cumulativeEffortMinutes: z
    .number()
    .nullable()
    .describe('Effort of this task plus every earlier-deadline unfinished task. Null when not assessed.'),
  availableMinutes: z.number().nullable().describe('Unoccupied calendar minutes between the planning start and the deadline. Null when not assessed.'),
  slackMinutes: z.number().nullable().describe('availableMinutes minus cumulativeEffortMinutes; negative when infeasible. Null when not assessed.'),
  note: z.string().describe('Plain-language explanation of the verdict and its limits'),
});
export type TaskFinding = z.infer<typeof taskFindingSchema>;

// ---------------------------------------------------------------------------------------------
// Conflict analysis output
// ---------------------------------------------------------------------------------------------

export const CONFLICT_CATEGORIES = ['event_overlap', 'task_deadline'] as const;

export const conflictSchema = z.object({
  issueId: z.string().describe('Stable identifier: the same inputs always give the same ID'),
  category: z.enum(CONFLICT_CATEGORIES),
  severity: severitySchema,
  affectedEventIds: z.array(z.string()),
  affectedTaskIds: z.array(z.string()),
  description: z.string(),
  interval: intervalSchema.nullable().describe('Time span the conflict covers, when it has one'),
  introducedByDisruption: z.boolean().describe('True when the conflict exists only because of the hypothetical disruption'),
  resolvable: z.boolean().describe('Whether the conflict appears resolvable under the current constraints. A planning estimate; propose_recovery_plan decides.'),
  suggestedNextStep: z.string(),
});
export type Conflict = z.infer<typeof conflictSchema>;

export const AFFECTED_IMPACTS = ['direct_overlap', 'cascade', 'existing_conflict'] as const;
export const affectedEventSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  impact: z
    .enum(AFFECTED_IMPACTS)
    .describe('direct_overlap: overlaps the extended event; cascade: displaced by another rescheduled event; existing_conflict: overlaps something even without a disruption'),
  canBeRescheduled: z.boolean().describe('False when the event is immovable, critical or user-protected'),
  reason: z.string(),
});

export const protectedConstraintSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority: severitySchema,
  reasons: z
    .array(z.enum(['immovable', 'critical_priority', 'user_protected', 'disrupted_event']))
    .describe('Why the planner will not reschedule this event. disrupted_event: it is the event that overran, which is observed rather than moved.'),
});

export const ASSESSMENT_STATUSES = ['no_conflicts', 'conflicts_resolvable', 'conflicts_unresolvable'] as const;

export const conflictAnalysisSchema = z.object({
  interval: intervalSchema,
  disruption: disruptionSchema.nullable().describe('The hypothetical disruption analysed; null for a baseline analysis'),
  eventsExamined: z.number().int().nonnegative(),
  tasksExamined: z.number().int().nonnegative().describe('Unfinished tasks considered'),
  existingConflicts: z.array(conflictSchema).describe('Conflicts present in the stored schedule, before any disruption'),
  newConflicts: z.array(conflictSchema).describe('Conflicts that appear only because of the disruption'),
  affectedEvents: z.array(affectedEventSchema),
  protectedConstraints: z.array(protectedConstraintSchema),
  taskAssessments: z.array(taskFindingSchema),
  warnings: z.array(z.string()),
  assessment: z.object({
    status: z.enum(ASSESSMENT_STATUSES),
    summary: z.string(),
  }),
});
export type ConflictAnalysis = z.infer<typeof conflictAnalysisSchema>;

// ---------------------------------------------------------------------------------------------
// Recovery plans
// ---------------------------------------------------------------------------------------------

export const STRATEGIES = ['minimal_disruption', 'buffered_transitions', 'priority_first'] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** One event moved by a plan. Times are ISO 8601 with the event's own UTC offset. */
export const eventChangeSchema = z.object({
  eventId: eventIdSchema,
  title: z.string().optional().describe('Event title (informational; the stored title is authoritative)'),
  originalStartTime: z.string().optional().describe('Start as stored. The validator checks this claim against the calendar.'),
  originalEndTime: z.string().optional().describe('End as stored. The validator checks this claim against the calendar.'),
  proposedStartTime: isoWithOffset.describe('New start: ISO 8601 with explicit UTC offset'),
  proposedEndTime: isoWithOffset.describe('New end: ISO 8601 with explicit UTC offset; must preserve the original duration'),
  reason: z.string().optional().describe('Why the event moves (informational)'),
});
export type EventChange = z.infer<typeof eventChangeSchema>;

/** What the validator needs. A full candidate from propose_recovery_plan satisfies this unchanged. */
export const planPayloadSchema = z.looseObject({
  planId: z.string().max(128).optional().describe('Identifier of the candidate, echoed back in the result'),
  startTime: isoWithOffset.describe('Planning interval start (ISO 8601 with offset), as given to propose_recovery_plan'),
  endTime: isoWithOffset.describe('Planning interval end (ISO 8601 with offset), as given to propose_recovery_plan'),
  disruption: disruptionSchema,
  changes: z.array(eventChangeSchema.loose()).max(MAX_PLAN_CHANGES).describe('Events the plan reschedules. The overrunning event itself is not listed: its overrun is the disruption.'),
  protectedEventIds: protectedEventIdsSchema.optional(),
  validation: z
    .looseObject({ isValid: z.boolean().optional() })
    .optional()
    .describe('Any validation result carried by the submitted plan. It is never trusted: the plan is re-validated from scratch.'),
});
export type RecoveryPlanPayload = z.infer<typeof planPayloadSchema>;

export const CHECK_NAMES = [
  'event_existence',
  'valid_time_range',
  'no_overlaps',
  'duration_preservation',
  'immovable_events',
  'critical_events',
  'protected_events',
  'deadline_feasibility',
  'scope_validity',
  'consistency',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const checkSchema = z.object({
  name: z.enum(CHECK_NAMES),
  passed: z.boolean(),
  severity: z.enum(['hard', 'warning']).describe('hard: failing makes the plan invalid; warning: a non-fatal concern'),
  eventId: z.string().nullable(),
  taskId: z.string().nullable(),
  message: z.string(),
});
export type Check = z.infer<typeof checkSchema>;

export const findingSchema = z.object({
  check: z.enum(CHECK_NAMES),
  eventId: z.string().nullable(),
  taskId: z.string().nullable(),
  message: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;

export const validationResultSchema = z.object({
  planId: z.string().optional(),
  isValid: z.boolean().describe('True only when every hard check passed in the independently reconstructed schedule'),
  checks: z.array(checkSchema),
  violations: z.array(findingSchema).describe('Hard-constraint violations; any one makes the plan invalid'),
  warnings: z.array(findingSchema).describe('Non-fatal concerns'),
  taskAssessments: z.array(taskFindingSchema).describe('Task-capacity findings recalculated under the proposed schedule'),
  summary: z.string(),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const scoreSchema = z.object({
  total: z.number().describe('Penalty points: LOWER IS BETTER. Deterministic for fixed inputs.'),
  rank: z.number().int().positive().describe('1 = recommended among the returned candidates'),
  hardViolations: z.number().int().nonnegative().describe('Hard-constraint violations found by the validator. Any value above zero disqualifies a plan; returned candidates always have zero.'),
  components: z.object({
    changedEvents: z.number(),
    priorityWeightedDelay: z.number(),
    focusTime: z.number(),
    tightTransitions: z.number(),
    taskRisk: z.number(),
  }),
  formula: z.string(),
});
export type PlanScore = z.infer<typeof scoreSchema>;

export const planChangeResultSchema = eventChangeSchema.extend({
  title: z.string(),
  originalStartTime: z.string(),
  originalEndTime: z.string(),
  reason: z.string(),
});
export type PlanChangeResult = z.infer<typeof planChangeResultSchema>;

export const recoveryPlanSchema = z.object({
  planId: z.string().describe('Deterministic identifier derived from the candidate content'),
  strategy: z.enum(STRATEGIES),
  summary: z.string(),
  startTime: z.string().describe('Planning interval start this plan was built for'),
  endTime: z.string().describe('Planning interval end this plan was built for'),
  protectedEventIds: z.array(z.string()).describe('User-supplied protected IDs this plan honours (sorted, unique)'),
  disruption: disruptionSchema,
  changes: z.array(planChangeResultSchema).describe('Events moved, relative to the stored schedule. Empty when no event needs to move.'),
  unchangedProtectedEvents: z.array(protectedConstraintSchema),
  taskAssessments: z.array(taskFindingSchema),
  explanation: z.object({
    changes: z.array(z.string()),
    unchanged: z.array(z.string()),
    rationale: z.array(z.string()),
    taskCapacity: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
  score: scoreSchema,
  validation: validationResultSchema,
});
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>;

export const INFEASIBILITY_CODES = ['fixed_conflict', 'no_slot', 'validation_failed'] as const;
export const planSetSchema = z.object({
  interval: intervalSchema,
  disruption: disruptionSchema,
  protectedEventIds: z.array(z.string()),
  outcome: z
    .enum(['plans_found', 'no_changes_needed', 'infeasible'])
    .describe('plans_found: at least one validated candidate; no_changes_needed: the overrun displaces nothing; infeasible: no candidate satisfies every hard constraint'),
  candidates: z.array(recoveryPlanSchema).describe('Independently validated candidates, best first. Empty when infeasible.'),
  discardedStrategies: z.array(z.object({ strategy: z.enum(STRATEGIES), reason: z.string() })),
  infeasibility: z
    .object({
      reasons: z.array(z.object({ code: z.enum(INFEASIBILITY_CODES), eventIds: z.array(z.string()), message: z.string() })),
      summary: z.string(),
    })
    .nullable()
    .describe('Why no plan exists. Null unless outcome is infeasible.'),
  rankingFormula: z.string(),
  warnings: z.array(z.string()),
  summary: z.string(),
});
export type RecoveryPlanSet = z.infer<typeof planSetSchema>;
