/** Envelope every API route returns, and the activity record behind the MCP activity panel. */
import type { ConflictAnalysis, RecoveryPlanSet, ScheduleEvent, Task, ValidationResult } from './contract';

export type ToolName =
  | 'get_schedule'
  | 'get_tasks'
  | 'analyze_conflicts'
  | 'propose_recovery_plan'
  | 'validate_recovery_plan'
  | 'save_recovery_plans'
  | 'get_recovery_plans'
  | 'approve_recovery_plan'
  | 'reject_recovery_plan'
  | 'apply_approved_plan'
  | 'get_action_history';

/** One real MCP tool call made by the server on behalf of the browser. */
export interface ToolActivity {
  id: string;
  tool: ToolName;
  status: 'success' | 'error';
  /** ISO timestamp (UTC) of when the call started. */
  startedAt: string;
  durationMs: number;
  /** Short, factual outcome derived from the actual result ("3 events"), or the error message. */
  summary: string;
  /** Machine-readable failure class, present only when status is "error". */
  errorCode?: ApiErrorCode;
}

export type ApiErrorCode =
  | 'invalid_request'
  | 'payload_too_large'
  | 'mcp_unavailable'
  | 'mcp_timeout'
  | 'mcp_tool_error'
  | 'mcp_protocol_error'
  | 'malformed_result'
  | 'misconfigured'
  | 'internal_error'
  | 'network_error'
  | 'bad_response';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Field-keyed validation messages for invalid_request. */
  fields?: Record<string, string>;
}

export type ApiResponse<T> =
  | { ok: true; data: T; activity: ToolActivity[] }
  | { ok: false; error: ApiError; activity: ToolActivity[] };

export interface DashboardData {
  date: string;
  /** Time zone the calendar claims (from get_schedule). */
  calendarTimeZone: string;
  taskTimeZone: string;
  /** UTC offset of the selected date in the configured calendar zone, e.g. "+05:30". */
  utcOffset: string;
  window: { startTime: string; endTime: string };
  taskWindow: { startTime: string; endTime: string };
  events: ScheduleEvent[];
  tasks: Task[];
  /** Baseline analysis of the stored schedule (no disruption); null when that call did not succeed. */
  baseline: { window: { startTime: string; endTime: string }; analysis: ConflictAnalysis } | null;
  baselineError: string | null;
}

export type AnalyzeData = ConflictAnalysis;
export type ProposeData = RecoveryPlanSet;
export type ValidateData = ValidationResult;

export type ApproveData = import('./contract').ApproveRecoveryPlanOutput;
export type RejectData = import('./contract').RejectRecoveryPlanOutput;
export type ApplyData = import('./contract').ApplyApprovedPlanOutput;
export type HistoryData = import('./contract').GetActionHistoryOutput;

