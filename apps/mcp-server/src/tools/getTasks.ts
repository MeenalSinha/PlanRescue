import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { SEED_TIME_ZONE } from '../data/seedSchedule.js';
import { InvalidQueryError } from '../lib/errors.js';
import { isoWithOffset, toEpochMs } from '../lib/time.js';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import type { Logger } from '../logger.js';
import { TASK_STATUSES, taskSchema, type Task, type TaskQuery, type TaskRepository } from '../types.js';

export const GET_TASKS_TOOL = 'get_tasks';

export const getTasksInputSchema = z.object({
  startDeadline: isoWithOffset
    .optional()
    .describe(
      'Only tasks due at or after this instant. ISO 8601 with an explicit UTC offset, e.g. 2026-10-22T00:00:00+05:30. Omit for no lower bound.',
    ),
  endDeadline: isoWithOffset
    .optional()
    .describe(
      'Only tasks due strictly before this instant. ISO 8601 with an explicit UTC offset; must be after startDeadline when both are given. Omit for no upper bound.',
    ),
  status: z.enum(TASK_STATUSES).optional().describe('Only tasks with this status. Omit to include every status.'),
});

export const getTasksOutputSchema = z.object({
  taskTimeZone: z.string().describe('IANA time zone the deadlines belong to'),
  query: z
    .object({
      startDeadline: z.string().optional().describe('Requested deadline lower bound, as supplied'),
      endDeadline: z.string().optional().describe('Requested deadline upper bound, as supplied'),
      status: z.enum(TASK_STATUSES).optional().describe('Requested status filter'),
    })
    .describe('The filters that were applied; omitted filters were not applied'),
  count: z.number().int().nonnegative().describe('Number of matching tasks'),
  tasks: z.array(taskSchema).describe('Matching tasks ordered by deadline, then priority (critical first), then id'),
});
export type GetTasksOutput = z.infer<typeof getTasksOutputSchema>;

export interface GetTasksDeps {
  repository: TaskRepository;
  logger: Logger;
}

/** Human-readable description of the active filters, used in text output and logs. */
function describeFilters(query: GetTasksOutput['query']): string {
  const parts: string[] = [];
  if (query.status) parts.push(`status ${query.status}`);
  if (query.startDeadline) parts.push(`due at or after ${query.startDeadline}`);
  if (query.endDeadline) parts.push(`due before ${query.endDeadline}`);
  return parts.length ? parts.join(', ') : 'no filters';
}

/** Readable summary returned alongside the structured result. */
export function formatTasksText(output: GetTasksOutput): string {
  const { query, count, tasks, taskTimeZone } = output;
  const filters = describeFilters(query);
  if (count === 0) {
    return `No tasks match (${filters}; task time zone ${taskTimeZone}).`;
  }
  const header = `${count} task${count === 1 ? '' : 's'} (${filters}; task time zone ${taskTimeZone}):`;
  const lines = tasks.map(
    (t, i) =>
      `${i + 1}. ${t.title} | due ${t.deadline} | ${t.estimatedDurationMinutes} min | priority ${t.priority} | ${t.status} | id ${t.id}`,
  );
  return [header, ...lines].join('\n');
}

/** Register the get_tasks tool on an MCP server. */
export function registerGetTasksTool(server: McpServer, deps: GetTasksDeps): string {
  const { repository, logger } = deps;

  server.registerTool(
    GET_TASKS_TOOL,
    {
      title: 'Get tasks',
      description:
        "Retrieve the user's tasks with their deadlines, estimated durations, priorities and statuses. " +
        'Unlike calendar events, tasks have no fixed time slot: they are work that must be fitted around events before a deadline. ' +
        'All filters are optional and combine with AND; with no filters every task is returned. ' +
        'startDeadline is inclusive and endDeadline is exclusive. Timestamps must be ISO 8601 with an explicit UTC offset ' +
        '(for example 2026-10-22T00:00:00+05:30). Results are ordered by deadline, then priority (critical first).',
      inputSchema: withValidationReporting(getTasksInputSchema, (issues) =>
        logger.warn(`Tool: ${GET_TASKS_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: getTasksOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ startDeadline, endDeadline, status }) => {
      const started = performance.now();
      const query: GetTasksOutput['query'] = {
        ...(startDeadline !== undefined ? { startDeadline } : {}),
        ...(endDeadline !== undefined ? { endDeadline } : {}),
        ...(status !== undefined ? { status } : {}),
      };
      logger.info(`Tool: ${GET_TASKS_TOOL} | Filters: ${describeFilters(query)}`);

      const repositoryQuery: TaskQuery = {
        ...(startDeadline !== undefined ? { deadlineFromMs: toEpochMs(startDeadline) } : {}),
        ...(endDeadline !== undefined ? { deadlineToMs: toEpochMs(endDeadline) } : {}),
        ...(status !== undefined ? { status } : {}),
      };
      if (
        repositoryQuery.deadlineFromMs !== undefined &&
        repositoryQuery.deadlineToMs !== undefined &&
        repositoryQuery.deadlineToMs <= repositoryQuery.deadlineFromMs
      ) {
        const reason = 'endDeadline must be strictly after startDeadline';
        logger.warn(`Tool: ${GET_TASKS_TOOL} | Status: rejected | Reason: ${reason}`);
        return { isError: true, content: [{ type: 'text' as const, text: `Invalid deadline range: ${reason}.` }] };
      }

      try {
        const tasks: Task[] = await repository.findTasks(repositoryQuery);
        const output: GetTasksOutput = { taskTimeZone: SEED_TIME_ZONE, query, count: tasks.length, tasks };
        logger.info(
          `Tool: ${GET_TASKS_TOOL} | Matching tasks: ${tasks.length} | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );
        return {
          content: [{ type: 'text' as const, text: formatTasksText(output) }],
          structuredContent: output,
        };
      } catch (error) {
        if (error instanceof InvalidQueryError) {
          logger.warn(`Tool: ${GET_TASKS_TOOL} | Status: rejected | Reason: ${error.message}`);
          return { isError: true, content: [{ type: 'text' as const, text: `Invalid query: ${error.message}.` }] };
        }
        logger.error(`Tool: ${GET_TASKS_TOOL} | Status: failure | ${error instanceof Error ? error.message : String(error)}`);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'The tasks could not be retrieved due to an internal error.' }],
        };
      }
    },
  );

  return GET_TASKS_TOOL;
}
