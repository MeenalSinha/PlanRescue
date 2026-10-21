import { McpServer } from '@modelcontextprotocol/server';
import type { Logger } from './logger.js';
import { registerGetScheduleTool } from './tools/getSchedule.js';
import { registerGetTasksTool } from './tools/getTasks.js';
import type { ScheduleRepository, TaskRepository } from './types.js';

export const SERVER_NAME = 'planrescue-mcp-server';
/** Keep in sync with package.json (enforced by tests/server-meta.test.ts). */
export const SERVER_VERSION = '0.1.0';

export interface ServerDeps {
  /** Calendar events. */
  repository: ScheduleRepository;
  /** Tasks and deadlines. */
  taskRepository: TaskRepository;
  logger: Logger;
}

export interface BuiltServer {
  server: McpServer;
  /** Names of the tools actually registered on this instance. */
  toolNames: string[];
}

/**
 * Build a fully configured PlanRescue MCP server. The HTTP layer calls this once per
 * request (stateless serving), so everything here must be cheap and free of shared mutable state.
 */
export function buildPlanRescueServer(deps: ServerDeps): BuiltServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: 'PlanRescue', version: SERVER_VERSION },
    {
      instructions:
        'PlanRescue is a consequence-aware schedule recovery assistant. ' +
        'Use get_schedule to read calendar events for an interval and get_tasks to read tasks, deadlines and their status ' +
        'before reasoning about conflicts: events occupy fixed time slots, tasks are work that must be fitted around them. ' +
        'All timestamps must be ISO 8601 with an explicit UTC offset.',
    },
  );
  const toolNames = [
    registerGetScheduleTool(server, { repository: deps.repository, logger: deps.logger }),
    registerGetTasksTool(server, { repository: deps.taskRepository, logger: deps.logger }),
  ];
  return { server, toolNames };
}
