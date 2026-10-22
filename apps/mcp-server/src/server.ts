import { McpServer } from '@modelcontextprotocol/server';
import type { Logger } from './logger.js';
import { registerAnalyzeConflictsTool } from './tools/analyzeConflicts.js';
import { registerGetScheduleTool } from './tools/getSchedule.js';
import { registerGetTasksTool } from './tools/getTasks.js';
import { registerProposeRecoveryPlanTool } from './tools/proposeRecoveryPlan.js';
import { registerValidateRecoveryPlanTool } from './tools/validateRecoveryPlan.js';
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
        'Use get_schedule to read calendar events for an interval and get_tasks to read tasks, deadlines and their status: ' +
        'events occupy fixed time slots, tasks are work that must be fitted around them. ' +
        'Use analyze_conflicts to find overlaps and deadline risks, optionally for a hypothetical event_overrun (an event that ran late). ' +
        'Use propose_recovery_plan to get deterministic, independently validated rescheduling candidates for such an overrun, and validate_recovery_plan to re-verify any candidate against the current calendar. ' +
        'The Recovery Engine is deterministic code: plans are computed and validated, never invented. All three recovery tools are read-only proposals; nothing is written to the calendar. ' +
        'Immovable, critical and user-protected events are never rescheduled. Task deadlines are assessed as aggregate capacity, not as assigned time slots. ' +
        'All timestamps must be ISO 8601 with an explicit UTC offset.',
    },
  );
  const recoveryDeps = { repository: deps.repository, taskRepository: deps.taskRepository, logger: deps.logger };
  const toolNames = [
    registerGetScheduleTool(server, { repository: deps.repository, logger: deps.logger }),
    registerGetTasksTool(server, { repository: deps.taskRepository, logger: deps.logger }),
    registerAnalyzeConflictsTool(server, recoveryDeps),
    registerProposeRecoveryPlanTool(server, recoveryDeps),
    registerValidateRecoveryPlanTool(server, recoveryDeps),
  ];
  return { server, toolNames };
}
