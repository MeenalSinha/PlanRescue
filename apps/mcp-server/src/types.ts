import * as z from 'zod/v4';

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const CATEGORIES = ['meeting', 'focus', 'medical', 'deadline_work', 'personal'] as const;
export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Upper bound for a single task estimate: one week of minutes. Mirrored by a CHECK constraint in the database. */
export const MAX_TASK_DURATION_MINUTES = 10_080;

/**
 * Calendar event as stored by a schedule repository.
 * Timestamps are ISO 8601 with an explicit UTC offset.
 */
export const scheduleEventSchema = z.object({
  id: z.string().describe('Stable event identifier'),
  title: z.string().describe('Human-readable event title'),
  startTime: z.string().describe('ISO 8601 start timestamp with explicit UTC offset'),
  endTime: z.string().describe('ISO 8601 end timestamp with explicit UTC offset'),
  priority: z.enum(PRIORITIES).describe('Importance of the event; critical events must not be sacrificed'),
  movable: z.boolean().describe('Whether the event may be rescheduled'),
  category: z.enum(CATEGORIES).describe('Kind of event'),
  notes: z.string().optional().describe('Optional context, such as a deadline attached to a work block'),
});
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

/** Event as returned by the get_schedule tool: stored fields plus a derived duration. */
export const scheduleEventResultSchema = scheduleEventSchema.extend({
  durationMinutes: z.number().int().positive().describe('Length of the event in whole minutes'),
});
export type ScheduleEventResult = z.infer<typeof scheduleEventResultSchema>;

/** A validated, half-open query interval [startMs, endMs) expressed in epoch milliseconds. */
export interface TimeRange {
  startMs: number;
  endMs: number;
}

/**
 * Data-access seam for calendar events. Implemented by the in-memory seed repository
 * (Phase 1, still used by unit tests) and by the SQLite repository (Phase 2, used by the
 * running server). The MCP server and tools depend only on this interface.
 */
export interface ScheduleRepository {
  /** Events overlapping the range, in chronological order. */
  findOverlapping(range: TimeRange): Promise<ScheduleEvent[]>;
  /** Apply schedule changes atomically. If any event's original time does not match, throws an error. */
  applyEventChanges?(changes: EventChangeUpdate[]): Promise<void>;
}

export interface EventChangeUpdate {
  eventId: string;
  originalStartTime: string;
  originalEndTime: string;
  proposedStartTime: string;
  proposedEndTime: string;
}

/**
 * A unit of work that must be fitted around calendar events. Unlike an event, a task has
 * no fixed slot: it has an estimated effort and a deadline. Deadlines are absolute instants
 * written as ISO 8601 with an explicit UTC offset, so the user's local time is preserved.
 */
export const taskSchema = z.object({
  id: z.string().min(1).describe('Stable task identifier'),
  title: z.string().trim().min(1).describe('Human-readable task title'),
  description: z.string().optional().describe('Optional details about the task'),
  estimatedDurationMinutes: z
    .number()
    .int()
    .positive()
    .max(MAX_TASK_DURATION_MINUTES)
    .describe('Estimated effort in whole minutes'),
  deadline: z.string().describe('ISO 8601 deadline with explicit UTC offset'),
  priority: z.enum(PRIORITIES).describe('Importance of the task'),
  status: z.enum(TASK_STATUSES).describe('Completion status'),
  createdAt: z.string().describe('ISO 8601 UTC timestamp of creation'),
  updatedAt: z.string().describe('ISO 8601 UTC timestamp of the last modification'),
});
export type Task = z.infer<typeof taskSchema>;

/**
 * Task filter. Every field is optional and an omitted field imposes no restriction.
 * The deadline window is half-open, [deadlineFromMs, deadlineToMs), matching calendar queries.
 */
export interface TaskQuery {
  /** Inclusive lower bound on the deadline, in epoch milliseconds. */
  deadlineFromMs?: number;
  /** Exclusive upper bound on the deadline, in epoch milliseconds. */
  deadlineToMs?: number;
  status?: TaskStatus;
}

/** Data-access seam for tasks. */
export interface TaskRepository {
  /**
   * Tasks matching the filter, ordered by deadline, then priority (critical first), then id.
   * Throws InvalidQueryError for an unusable filter; an empty result is a normal outcome.
   */
  findTasks(query?: TaskQuery): Promise<Task[]>;
}

// ---------------------------------------------------------------------------
// Phase 6: Recovery Plan Lifecycle & Action History
// ---------------------------------------------------------------------------

export const RECOVERY_PLAN_STATUSES = ['proposed', 'approved', 'rejected', 'applied', 'stale'] as const;
export type RecoveryPlanStatus = (typeof RECOVERY_PLAN_STATUSES)[number];

export const ACTION_TYPES = [
  'plan_saved',
  'plan_approved',
  'plan_rejected',
  'approval_cancelled',
  'plan_applied',
  'plan_stale',
  'apply_failed',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface SavedRecoveryPlan {
  id: string;
  requestId: string;
  sourcePlanId: string;
  status: RecoveryPlanStatus;
  planJson: string;
  planningStart: string;
  planningEnd: string;
  snapshotHash: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  appliedAt?: string;
}

export interface NewRecoveryPlan {
  id: string;
  requestId: string;
  sourcePlanId: string;
  status: RecoveryPlanStatus;
  planJson: string;
  planningStart: string;
  planningEnd: string;
  snapshotHash: string;
}

export interface RecoveryPlanQuery {
  planId?: string;
  status?: RecoveryPlanStatus;
  requestId?: string;
  limit?: number;
}

export interface ApplyApprovedPlanParams {
  planId: string;
  actor: string;
  updates: EventChangeUpdate[];
  historyDetailsJson: string;
}

export interface RecoveryPlanRepository {
  savePlan(plan: NewRecoveryPlan): Promise<SavedRecoveryPlan>;
  getPlan(id: string): Promise<SavedRecoveryPlan | null>;
  findPlans(query?: RecoveryPlanQuery): Promise<SavedRecoveryPlan[]>;
  updatePlanStatus(
    id: string,
    toStatus: RecoveryPlanStatus,
    options?: {
      expectedStatus?: RecoveryPlanStatus | RecoveryPlanStatus[];
      approvedAt?: string;
      rejectedAt?: string;
      appliedAt?: string;
    },
  ): Promise<SavedRecoveryPlan>;
  applyApprovedPlanAtomically?(params: ApplyApprovedPlanParams): Promise<SavedRecoveryPlan>;
}

export interface ActionHistoryEntry {
  id: string;
  recoveryPlanId?: string;
  actionType: ActionType;
  occurredAt: string;
  actor: string;
  detailsJson?: string;
}

export interface NewActionHistoryEntry {
  id?: string;
  recoveryPlanId?: string;
  actionType: ActionType;
  occurredAt?: string;
  actor: string;
  detailsJson?: string;
}

export interface ActionHistoryQuery {
  recoveryPlanId?: string;
  actionType?: ActionType;
  limit?: number;
}

export interface ActionHistoryRepository {
  recordAction(entry: NewActionHistoryEntry): Promise<ActionHistoryEntry>;
  findActions(query?: ActionHistoryQuery): Promise<ActionHistoryEntry[]>;
}

