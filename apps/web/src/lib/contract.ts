/**
 * Shape of what the PlanRescue MCP tools return, as the web application relies on it.
 *
 * This is a CONTRACT CHECK, not business logic: it lets the server-side client reject a malformed
 * result instead of rendering it. Every object is a loose object so fields this file does not name
 * (and therefore never inspects) survive untouched; that matters because a candidate plan is passed
 * back to validate_recovery_plan exactly as the Recovery Engine returned it.
 */
import * as z from 'zod';

const priority = z.enum(['critical', 'high', 'medium', 'low']);
export type Priority = z.infer<typeof priority>;

export const scheduleEventSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority,
  movable: z.boolean(),
  category: z.enum(['meeting', 'focus', 'medical', 'deadline_work', 'personal']),
  notes: z.string().optional(),
  durationMinutes: z.number(),
});
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

export const scheduleOutputSchema = z.looseObject({
  calendarTimeZone: z.string(),
  count: z.number(),
  events: z.array(scheduleEventSchema),
});
export type ScheduleOutput = z.infer<typeof scheduleOutputSchema>;

export const taskSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  estimatedDurationMinutes: z.number(),
  deadline: z.string(),
  priority,
  status: z.enum(['pending', 'in_progress', 'completed']),
});
export type Task = z.infer<typeof taskSchema>;

export const tasksOutputSchema = z.looseObject({
  taskTimeZone: z.string(),
  count: z.number(),
  tasks: z.array(taskSchema),
});
export type TasksOutput = z.infer<typeof tasksOutputSchema>;

const interval = z.looseObject({ startTime: z.string(), endTime: z.string() });

export const disruptionSchema = z.looseObject({
  type: z.literal('event_overrun'),
  eventId: z.string(),
  overrunMinutes: z.number(),
});
export type Disruption = z.infer<typeof disruptionSchema>;

const capacityStatus = z.enum(['feasible', 'at_risk', 'infeasible', 'not_assessed']);
export type CapacityStatus = z.infer<typeof capacityStatus>;
const riskOrigin = z.enum(['none', 'pre_existing', 'disruption', 'plan_introduced']);
export type RiskOrigin = z.infer<typeof riskOrigin>;

export const taskFindingSchema = z.looseObject({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string(),
  priority,
  estimatedDurationMinutes: z.number(),
  status: capacityStatus,
  baselineStatus: capacityStatus,
  origin: riskOrigin,
  cumulativeEffortMinutes: z.number().nullable(),
  availableMinutes: z.number().nullable(),
  slackMinutes: z.number().nullable(),
  note: z.string(),
});
export type TaskFinding = z.infer<typeof taskFindingSchema>;

export const conflictSchema = z.looseObject({
  issueId: z.string(),
  category: z.enum(['event_overlap', 'task_deadline']),
  severity: priority,
  affectedEventIds: z.array(z.string()),
  affectedTaskIds: z.array(z.string()),
  description: z.string(),
  interval: interval.nullable(),
  introducedByDisruption: z.boolean(),
  resolvable: z.boolean(),
  suggestedNextStep: z.string(),
});
export type Conflict = z.infer<typeof conflictSchema>;

export const protectedConstraintSchema = z.looseObject({
  eventId: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority,
  reasons: z.array(z.enum(['immovable', 'critical_priority', 'user_protected', 'disrupted_event'])),
});
export type ProtectedConstraint = z.infer<typeof protectedConstraintSchema>;

export const affectedEventSchema = z.looseObject({
  eventId: z.string(),
  title: z.string(),
  impact: z.enum(['direct_overlap', 'cascade', 'existing_conflict']),
  canBeRescheduled: z.boolean(),
  reason: z.string(),
});
export type AffectedEvent = z.infer<typeof affectedEventSchema>;

export const conflictAnalysisSchema = z.looseObject({
  interval,
  disruption: disruptionSchema.nullable(),
  eventsExamined: z.number(),
  tasksExamined: z.number(),
  existingConflicts: z.array(conflictSchema),
  newConflicts: z.array(conflictSchema),
  affectedEvents: z.array(affectedEventSchema),
  protectedConstraints: z.array(protectedConstraintSchema),
  taskAssessments: z.array(taskFindingSchema),
  warnings: z.array(z.string()),
  assessment: z.looseObject({
    status: z.enum(['no_conflicts', 'conflicts_resolvable', 'conflicts_unresolvable']),
    summary: z.string(),
  }),
});
export type ConflictAnalysis = z.infer<typeof conflictAnalysisSchema>;

const finding = z.looseObject({
  check: z.string(),
  eventId: z.string().nullable(),
  taskId: z.string().nullable(),
  message: z.string(),
});
export type Finding = z.infer<typeof finding>;

export const validationResultSchema = z.looseObject({
  planId: z.string().optional(),
  isValid: z.boolean(),
  checks: z.array(
    z.looseObject({
      name: z.string(),
      passed: z.boolean(),
      severity: z.enum(['hard', 'warning']),
      eventId: z.string().nullable(),
      taskId: z.string().nullable(),
      message: z.string(),
    }),
  ),
  violations: z.array(finding),
  warnings: z.array(finding),
  taskAssessments: z.array(taskFindingSchema),
  summary: z.string(),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const planChangeSchema = z.looseObject({
  eventId: z.string(),
  title: z.string(),
  originalStartTime: z.string(),
  originalEndTime: z.string(),
  proposedStartTime: z.string(),
  proposedEndTime: z.string(),
  reason: z.string(),
});
export type PlanChange = z.infer<typeof planChangeSchema>;

export const recoveryPlanSchema = z.looseObject({
  planId: z.string(),
  strategy: z.enum(['minimal_disruption', 'buffered_transitions', 'priority_first']),
  summary: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  protectedEventIds: z.array(z.string()),
  disruption: disruptionSchema,
  changes: z.array(planChangeSchema),
  unchangedProtectedEvents: z.array(protectedConstraintSchema),
  taskAssessments: z.array(taskFindingSchema),
  explanation: z.looseObject({
    changes: z.array(z.string()),
    unchanged: z.array(z.string()),
    rationale: z.array(z.string()),
    taskCapacity: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
  score: z.looseObject({
    total: z.number(),
    rank: z.number(),
    hardViolations: z.number(),
    components: z.looseObject({
      changedEvents: z.number(),
      priorityWeightedDelay: z.number(),
      focusTime: z.number(),
      tightTransitions: z.number(),
      taskRisk: z.number(),
    }),
    formula: z.string(),
  }),
  validation: validationResultSchema,
});
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>;

export const planSetSchema = z.looseObject({
  interval,
  disruption: disruptionSchema,
  protectedEventIds: z.array(z.string()),
  outcome: z.enum(['plans_found', 'no_changes_needed', 'infeasible']),
  candidates: z.array(recoveryPlanSchema),
  discardedStrategies: z.array(z.looseObject({ strategy: z.string(), reason: z.string() })),
  infeasibility: z
    .looseObject({
      reasons: z.array(z.looseObject({ code: z.string(), eventIds: z.array(z.string()), message: z.string() })),
      summary: z.string(),
    })
    .nullable(),
  rankingFormula: z.string(),
  warnings: z.array(z.string()),
  summary: z.string(),
});
export type RecoveryPlanSet = z.infer<typeof planSetSchema>;
