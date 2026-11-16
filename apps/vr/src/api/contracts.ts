/**
 * PlanRescue Spatial - VR API Contracts
 * 100% contract-parity with Next.js route handlers and backend MCP tools.
 */
import * as z from 'zod';

export const prioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Priority = z.infer<typeof prioritySchema>;

export const scheduleEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority: prioritySchema,
  movable: z.boolean(),
  category: z.enum(['meeting', 'focus', 'medical', 'deadline_work', 'personal']),
  notes: z.string().optional(),
  durationMinutes: z.number(),
}).passthrough();
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

export const scheduleOutputSchema = z.object({
  calendarTimeZone: z.string(),
  count: z.number(),
  events: z.array(scheduleEventSchema),
}).passthrough();
export type ScheduleOutput = z.infer<typeof scheduleOutputSchema>;

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  estimatedDurationMinutes: z.number(),
  deadline: z.string(),
  priority: prioritySchema,
  status: z.enum(['pending', 'in_progress', 'completed']),
}).passthrough();
export type Task = z.infer<typeof taskSchema>;

export const tasksOutputSchema = z.object({
  taskTimeZone: z.string(),
  count: z.number(),
  tasks: z.array(taskSchema),
}).passthrough();
export type TasksOutput = z.infer<typeof tasksOutputSchema>;

export const intervalSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
}).passthrough();
export type Interval = z.infer<typeof intervalSchema>;

export const disruptionSchema = z.object({
  type: z.literal('event_overrun'),
  eventId: z.string(),
  overrunMinutes: z.number().int().min(1).max(240),
}).passthrough();
export type Disruption = z.infer<typeof disruptionSchema>;

export const capacityStatusSchema = z.enum(['feasible', 'at_risk', 'infeasible', 'not_assessed']);
export type CapacityStatus = z.infer<typeof capacityStatusSchema>;

export const riskOriginSchema = z.enum(['none', 'pre_existing', 'disruption', 'plan_introduced']);
export type RiskOrigin = z.infer<typeof riskOriginSchema>;

export const taskFindingSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string(),
  priority: prioritySchema,
  estimatedDurationMinutes: z.number(),
  status: capacityStatusSchema,
  baselineStatus: capacityStatusSchema,
  origin: riskOriginSchema,
  cumulativeEffortMinutes: z.number().nullable(),
  availableMinutes: z.number().nullable(),
  slackMinutes: z.number().nullable(),
  note: z.string(),
}).passthrough();
export type TaskFinding = z.infer<typeof taskFindingSchema>;

export const conflictSchema = z.object({
  issueId: z.string(),
  category: z.enum(['event_overlap', 'task_deadline']),
  severity: prioritySchema,
  affectedEventIds: z.array(z.string()),
  affectedTaskIds: z.array(z.string()),
  description: z.string(),
  interval: intervalSchema.nullable(),
  introducedByDisruption: z.boolean(),
  resolvable: z.boolean(),
  suggestedNextStep: z.string(),
}).passthrough();
export type Conflict = z.infer<typeof conflictSchema>;

export const protectedConstraintSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority: prioritySchema,
  reasons: z.array(z.enum(['immovable', 'critical_priority', 'user_protected', 'disrupted_event'])),
}).passthrough();
export type ProtectedConstraint = z.infer<typeof protectedConstraintSchema>;

export const affectedEventSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  impact: z.enum(['direct_overlap', 'cascade', 'existing_conflict']),
  canBeRescheduled: z.boolean(),
  reason: z.string(),
}).passthrough();
export type AffectedEvent = z.infer<typeof affectedEventSchema>;

export const conflictAnalysisSchema = z.object({
  interval: intervalSchema,
  disruption: disruptionSchema.nullable(),
  eventsExamined: z.number(),
  tasksExamined: z.number(),
  existingConflicts: z.array(conflictSchema),
  newConflicts: z.array(conflictSchema),
  affectedEvents: z.array(affectedEventSchema),
  protectedConstraints: z.array(protectedConstraintSchema),
  taskAssessments: z.array(taskFindingSchema),
  warnings: z.array(z.string()),
  assessment: z.object({
    status: z.enum(['no_conflicts', 'conflicts_resolvable', 'conflicts_unresolvable']),
    summary: z.string(),
  }).passthrough(),
}).passthrough();
export type ConflictAnalysis = z.infer<typeof conflictAnalysisSchema>;

export const findingSchema = z.object({
  check: z.string(),
  eventId: z.string().nullable(),
  taskId: z.string().nullable(),
  message: z.string(),
}).passthrough();
export type Finding = z.infer<typeof findingSchema>;

export const validationResultSchema = z.object({
  planId: z.string().optional(),
  isValid: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      severity: z.enum(['hard', 'warning']),
      eventId: z.string().nullable(),
      taskId: z.string().nullable(),
      message: z.string(),
    }).passthrough(),
  ),
  violations: z.array(findingSchema),
  warnings: z.array(findingSchema),
  taskAssessments: z.array(taskFindingSchema),
  summary: z.string(),
}).passthrough();
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const planChangeSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  originalStartTime: z.string(),
  originalEndTime: z.string(),
  proposedStartTime: z.string(),
  proposedEndTime: z.string(),
  reason: z.string(),
}).passthrough();
export type PlanChange = z.infer<typeof planChangeSchema>;

export const recoveryPlanSchema = z.object({
  planId: z.string(),
  persistentId: z.string().optional(),
  savedStatus: z.enum(['proposed', 'approved', 'rejected', 'applied', 'stale']).optional(),
  strategy: z.enum(['minimal_disruption', 'buffered_transitions', 'priority_first']),
  summary: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  protectedEventIds: z.array(z.string()),
  disruption: disruptionSchema,
  changes: z.array(planChangeSchema),
  unchangedProtectedEvents: z.array(protectedConstraintSchema),
  taskAssessments: z.array(taskFindingSchema),
  explanation: z.object({
    changes: z.array(z.string()),
    unchanged: z.array(z.string()),
    rationale: z.array(z.string()),
    taskCapacity: z.array(z.string()),
    limitations: z.array(z.string()),
  }).passthrough(),
  score: z.object({
    total: z.number(),
    rank: z.number(),
    hardViolations: z.number(),
    components: z.object({
      changedEvents: z.number(),
      priorityWeightedDelay: z.number(),
      focusTime: z.number(),
      tightTransitions: z.number(),
      taskRisk: z.number(),
    }).passthrough(),
    formula: z.string(),
  }).passthrough(),
  validation: validationResultSchema,
}).passthrough();
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>;

export const planSetSchema = z.object({
  interval: intervalSchema,
  disruption: disruptionSchema,
  protectedEventIds: z.array(z.string()),
  outcome: z.enum(['plans_found', 'no_changes_needed', 'infeasible']),
  candidates: z.array(recoveryPlanSchema),
  discardedStrategies: z.array(z.object({ strategy: z.string(), reason: z.string() }).passthrough()),
  infeasibility: z
    .object({
      reasons: z.array(z.object({ code: z.string(), eventIds: z.array(z.string()), message: z.string() }).passthrough()),
      summary: z.string(),
    })
    .passthrough()
    .nullable()
    .optional(),
  rankingFormula: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  summary: z.string(),
}).passthrough();
export type RecoveryPlanSet = z.infer<typeof planSetSchema>;

export const approveRecoveryPlanOutputSchema = z.object({
  planId: z.string(),
  status: z.literal('approved'),
  approvedAt: z.string(),
  strategy: z.string(),
  summary: z.string(),
  message: z.string(),
}).passthrough();
export type ApproveRecoveryPlanOutput = z.infer<typeof approveRecoveryPlanOutputSchema>;

export const applyApprovedPlanOutputSchema = z.object({
  planId: z.string(),
  status: z.literal('applied'),
  appliedAt: z.string(),
  strategy: z.string(),
  changesCount: z.number(),
  changes: z.array(
    z.object({
      eventId: z.string(),
      title: z.string(),
      previousStartTime: z.string(),
      previousEndTime: z.string(),
      newStartTime: z.string(),
      newEndTime: z.string(),
    }).passthrough(),
  ),
  message: z.string(),
}).passthrough();
export type ApplyApprovedPlanOutput = z.infer<typeof applyApprovedPlanOutputSchema>;

export const actionHistoryItemSchema = z.object({
  id: z.string(),
  recoveryPlanId: z.string().optional(),
  actionType: z.enum([
    'plan_saved',
    'plan_approved',
    'plan_rejected',
    'approval_cancelled',
    'plan_applied',
    'plan_stale',
    'apply_failed',
  ]),
  occurredAt: z.string(),
  actor: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.any()),
}).passthrough();
export type ActionHistoryItem = z.infer<typeof actionHistoryItemSchema>;

export const getActionHistoryOutputSchema = z.object({
  count: z.number(),
  entries: z.array(actionHistoryItemSchema),
}).passthrough();
export type GetActionHistoryOutput = z.infer<typeof getActionHistoryOutputSchema>;

export const dashboardDataSchema = z.object({
  date: z.string(),
  calendarTimeZone: z.string(),
  taskTimeZone: z.string(),
  utcOffset: z.string(),
  window: intervalSchema,
  taskWindow: intervalSchema,
  events: z.array(scheduleEventSchema),
  tasks: z.array(taskSchema),
  baseline: z.object({
    window: intervalSchema,
    analysis: conflictAnalysisSchema,
  }).nullable(),
  baselineError: z.string().nullable(),
}).passthrough();
export type DashboardData = z.infer<typeof dashboardDataSchema>;

export const toolActivitySchema = z.object({
  id: z.string(),
  tool: z.string(),
  status: z.enum(['success', 'error']),
  startedAt: z.string(),
  durationMs: z.number(),
  summary: z.string(),
  errorCode: z.string().optional(),
}).passthrough();
export type ToolActivity = z.infer<typeof toolActivitySchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
}).passthrough();
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      data: dataSchema,
      activity: z.array(toolActivitySchema).optional(),
    }),
    z.object({
      ok: z.literal(false),
      error: apiErrorSchema,
      activity: z.array(toolActivitySchema).optional(),
    }),
  ]);

// Phase 9: User Accounts, Identity & Personalization
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();
export type User = z.infer<typeof userSchema>;

export const focusPeriodSchema = z.object({
  id: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  daysOfWeek: z.array(z.string()),
}).passthrough();
export type FocusPeriod = z.infer<typeof focusPeriodSchema>;

export const spatialComfortSchema = z.object({
  viewDistance: z.number().default(1.4),
  handRayEnabled: z.boolean().default(true),
  hapticFeedback: z.boolean().default(true),
}).passthrough();
export type SpatialComfort = z.infer<typeof spatialComfortSchema>;

export const userPreferencesSchema = z.object({
  userId: z.string(),
  timezone: z.string().default('Asia/Kolkata'),
  workingDays: z.array(z.string()).default(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  workingHoursStart: z.string().default('09:00'),
  workingHoursEnd: z.string().default('18:00'),
  preferredStrategy: z.enum(['minimal_disruption', 'buffered_transitions', 'priority_first']).default('minimal_disruption'),
  preferredBufferMinutes: z.number().default(10),
  focusPeriods: z.array(focusPeriodSchema).default([]),
  spatialComfort: spatialComfortSchema.default({
    viewDistance: 1.4,
    handRayEnabled: true,
    hapticFeedback: true,
  }),
  updatedAt: z.string(),
}).passthrough();
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  sessionToken: z.string(),
  preferences: userPreferencesSchema,
}).passthrough();
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const sessionResponseSchema = z.object({
  user: userSchema,
  preferences: userPreferencesSchema,
  isAuthenticated: z.boolean(),
}).passthrough();
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// Phase 10: External Calendar Schemas
export const calendarAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(['google', 'outlook', 'local']),
  accountEmail: z.string().optional().nullable(),
  status: z.enum(['connected', 'syncing', 'error', 'disconnected']),
  lastSyncAt: z.number().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
}).passthrough();
export type CalendarAccount = z.infer<typeof calendarAccountSchema>;

export const calendarProviderItemSchema = z.object({
  id: z.enum(['google', 'outlook', 'local']),
  name: z.string(),
  description: z.string(),
  connected: z.boolean(),
  accountEmail: z.string().optional().nullable(),
  lastSyncAt: z.number().optional().nullable(),
}).passthrough();
export type CalendarProviderItem = z.infer<typeof calendarProviderItemSchema>;

export const calendarProvidersResponseSchema = z.object({
  providers: z.array(calendarProviderItemSchema),
}).passthrough();
export type CalendarProvidersResponse = z.infer<typeof calendarProvidersResponseSchema>;

export const calendarSyncResponseSchema = z.object({
  success: z.boolean(),
  provider: z.string(),
  importedCount: z.number(),
  updatedCount: z.number(),
  timestamp: z.string(),
}).passthrough();
export type CalendarSyncResponse = z.infer<typeof calendarSyncResponseSchema>;

// Phase 11: Productivity Intelligence Schemas
export const productivityMetricsSchema = z.object({
  healthScore: z.number().min(0).max(100),
  totalScheduledMinutes: z.number(),
  totalWorkingMinutes: z.number(),
  focusTimeMinutes: z.number(),
  fragmentedMinutes: z.number(),
  backToBackCount: z.number(),
  overloadPercentage: z.number(),
  contextSwitches: z.number(),
}).passthrough();
export type ProductivityMetrics = z.infer<typeof productivityMetricsSchema>;

export const productivityRecommendationSchema = z.object({
  id: z.string(),
  type: z.enum(['buffer_needed', 'consolidate_focus', 'reduce_overload', 'task_protection']),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  description: z.string(),
  suggestedAction: z.string(),
}).passthrough();
export type ProductivityRecommendation = z.infer<typeof productivityRecommendationSchema>;

export const productivityInsightsSchema = z.object({
  date: z.string(),
  metrics: productivityMetricsSchema,
  recommendations: z.array(productivityRecommendationSchema),
  summary: z.string(),
}).passthrough();
export type ProductivityInsights = z.infer<typeof productivityInsightsSchema>;



