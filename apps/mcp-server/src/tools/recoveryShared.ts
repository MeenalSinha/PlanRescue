import { InvalidQueryError, RecoveryInputError } from '../lib/errors.js';
import type { Logger } from '../logger.js';
import { checkPlanningWindow } from '../recovery/schedule.js';
import type { ScheduleEvent, ScheduleRepository, Task, TaskRepository } from '../types.js';

/** Dependencies shared by the three recovery tools. Both repositories are read-only seams. */
export interface RecoveryToolDeps {
  repository: ScheduleRepository;
  taskRepository: TaskRepository;
  logger: Logger;
}

/** Every recovery tool only reads. Annotations say so to clients. */
export const RECOVERY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export interface PlanningData {
  events: ScheduleEvent[];
  tasks: Task[];
}

/**
 * Read what the Recovery Engine needs through the existing repositories: calendar events overlapping
 * [startTime, endTime) and every task whose deadline falls in [startTime, endTime] (the closing
 * instant is included, because a deadline at the very end of the planning interval still matters).
 * The window is validated first, so an oversized or inverted interval never reaches the database.
 */
export async function loadPlanningData(deps: RecoveryToolDeps, startTime: string, endTime: string): Promise<PlanningData> {
  const { startMs, endMs } = checkPlanningWindow(startTime, endTime);
  const events = await deps.repository.findOverlapping({ startMs, endMs });
  const tasks = await deps.taskRepository.findTasks({ deadlineFromMs: startMs, deadlineToMs: endMs + 1 });
  return { events, tasks };
}

export function textError(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

/**
 * Map a failure to a tool error. Requests the caller can fix are reported as such and logged at warn
 * level; anything else is logged in full and reported generically, without leaking internals.
 */
export function failureResult(logger: Logger, tool: string, error: unknown) {
  if (error instanceof RecoveryInputError || error instanceof InvalidQueryError) {
    logger.warn(`Tool: ${tool} | Status: rejected | Reason: ${error.message}`);
    return textError(`Invalid request: ${error.message}`);
  }
  logger.error(`Tool: ${tool} | Status: failure | ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return textError('The request could not be processed due to an internal error.');
}
