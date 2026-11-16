import * as z from 'zod';

export const prioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Priority = z.infer<typeof prioritySchema>;

export const scheduleEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number(),
  priority: prioritySchema,
  movable: z.boolean(),
  category: z.enum(['meeting', 'focus', 'medical', 'deadline_work', 'personal']),
  notes: z.string().optional(),
}).passthrough();
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

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

export const disruptionSchema = z.object({
  type: z.literal('event_overrun'),
  eventId: z.string(),
  overrunMinutes: z.number().int().min(1).max(240),
});
export type Disruption = z.infer<typeof disruptionSchema>;

export const conflictSchema = z.object({
  issueId: z.string(),
  category: z.enum(['event_overlap', 'task_deadline']),
  severity: prioritySchema,
  affectedEventIds: z.array(z.string()),
  affectedTaskIds: z.array(z.string()),
  description: z.string(),
  interval: z.object({ startTime: z.string(), endTime: z.string() }).nullable(),
  introducedByDisruption: z.boolean(),
  resolvable: z.boolean(),
  suggestedNextStep: z.string(),
}).passthrough();
export type Conflict = z.infer<typeof conflictSchema>;

export const conflictAnalysisSchema = z.object({
  interval: z.object({ startTime: z.string(), endTime: z.string() }),
  disruption: disruptionSchema.nullable(),
  eventsExamined: z.number(),
  tasksExamined: z.number(),
  existingConflicts: z.array(conflictSchema),
  newConflicts: z.array(conflictSchema),
  resolvable: z.boolean(),
}).passthrough();
export type ConflictAnalysis = z.infer<typeof conflictAnalysisSchema>;

export const recoveryCandidateSchema = z.object({
  planId: z.string(),
  strategy: z.string(),
  description: z.string(),
  score: z.number(),
  isFeasible: z.boolean(),
  changes: z.array(
    z.object({
      eventId: z.string(),
      title: z.string(),
      originalStartTime: z.string(),
      originalEndTime: z.string(),
      newStartTime: z.string(),
      newEndTime: z.string(),
      shiftMinutes: z.number(),
    }).passthrough(),
  ),
  violations: z.array(z.string()).optional(),
}).passthrough();
export type RecoveryCandidate = z.infer<typeof recoveryCandidateSchema>;

export const recoveryPlanSetSchema = z.object({
  outcome: z.enum(['plans_found', 'infeasible', 'no_conflicts', 'disruption_unavoidable']),
  candidates: z.array(recoveryCandidateSchema),
  summary: z.string(),
}).passthrough();
export type RecoveryPlanSet = z.infer<typeof recoveryPlanSetSchema>;

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

export const dashboardDataSchema = z.object({
  date: z.string(),
  calendarTimeZone: z.string(),
  taskTimeZone: z.string(),
  utcOffset: z.string(),
  window: z.object({ startTime: z.string(), endTime: z.string() }),
  taskWindow: z.object({ startTime: z.string(), endTime: z.string() }),
  events: z.array(scheduleEventSchema),
  tasks: z.array(taskSchema),
  baseline: z.object({
    window: z.object({ startTime: z.string(), endTime: z.string() }),
    analysis: conflictAnalysisSchema,
  }).nullable().optional(),
  baselineError: z.string().nullable().optional(),
}).passthrough();
export type DashboardData = z.infer<typeof dashboardDataSchema>;

export const approvePlanResponseSchema = z.object({
  status: z.literal('approved'),
  planId: z.string(),
  approvedAt: z.string(),
}).passthrough();
export type ApprovePlanResponse = z.infer<typeof approvePlanResponseSchema>;

export const applyPlanResponseSchema = z.object({
  status: z.literal('applied'),
  planId: z.string(),
  appliedAt: z.string(),
  updatedEventsCount: z.number(),
}).passthrough();
export type ApplyPlanResponse = z.infer<typeof applyPlanResponseSchema>;

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
  activity?: ToolActivity[];
}
