import { McpServer } from '@modelcontextprotocol/server';
import type { Logger } from './logger.js';
import { registerAnalyzeConflictsTool } from './tools/analyzeConflicts.js';
import { registerGetScheduleTool } from './tools/getSchedule.js';
import { registerGetTasksTool } from './tools/getTasks.js';
import { registerProposeRecoveryPlanTool } from './tools/proposeRecoveryPlan.js';
import { registerValidateRecoveryPlanTool } from './tools/validateRecoveryPlan.js';
import { registerSaveRecoveryPlansTool } from './tools/saveRecoveryPlans.js';
import { registerGetRecoveryPlansTool } from './tools/getRecoveryPlans.js';
import { registerApproveRecoveryPlanTool } from './tools/approveRecoveryPlan.js';
import { registerRejectRecoveryPlanTool } from './tools/rejectRecoveryPlan.js';
import { registerApplyApprovedPlanTool } from './tools/applyApprovedPlan.js';
import { registerGetActionHistoryTool } from './tools/getActionHistory.js';
import type {
  ScheduleRepository,
  TaskRepository,
  RecoveryPlanRepository,
  ActionHistoryRepository,
} from './types.js';

export const SERVER_NAME = 'planrescue-mcp-server';
/** Keep in sync with package.json (enforced by tests/server-meta.test.ts). */
export const SERVER_VERSION = '0.1.0';

export interface ServerDeps {
  /** Calendar events. */
  repository: ScheduleRepository;
  /** Tasks and deadlines. */
  taskRepository: TaskRepository;
  /** Persistent recovery plans. */
  recoveryPlanRepository: RecoveryPlanRepository;
  /** Append-only action history. */
  actionHistoryRepository: ActionHistoryRepository;
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
        'Candidates can be persisted via save_recovery_plans and inspected via get_recovery_plans. ' +
        'Saved recovery plans follow a strict lifecycle: proposed -> approved -> applied (or rejected/stale). ' +
        'Plans are approved via approve_recovery_plan and rejected via reject_recovery_plan. ' +
        'Only explicitly approved plans can be executed against the SQLite calendar via apply_approved_plan. ' +
        'Generating, validating, or approving plans NEVER modifies calendar events; only apply_approved_plan updates event times atomically. ' +
        'Audit history of all plan lifecycle transitions is recorded and retrievable via get_action_history. ' +
        'Immovable, critical and user-protected events are never rescheduled. ' +
        'All timestamps must be ISO 8601 with an explicit UTC offset.',
    },
  );

  const recoveryDeps = {
    repository: deps.repository,
    taskRepository: deps.taskRepository,
    logger: deps.logger,
  };

  const lifecycleDeps = {
    repository: deps.repository,
    taskRepository: deps.taskRepository,
    recoveryPlanRepository: deps.recoveryPlanRepository,
    actionHistoryRepository: deps.actionHistoryRepository,
    logger: deps.logger,
  };

  const toolNames = [
    registerGetScheduleTool(server, { repository: deps.repository, logger: deps.logger }),
    registerGetTasksTool(server, { repository: deps.taskRepository, logger: deps.logger }),
    registerAnalyzeConflictsTool(server, recoveryDeps),
    registerProposeRecoveryPlanTool(server, recoveryDeps),
    registerValidateRecoveryPlanTool(server, recoveryDeps),
    registerSaveRecoveryPlansTool(server, lifecycleDeps),
    registerGetRecoveryPlansTool(server, { recoveryPlanRepository: deps.recoveryPlanRepository, logger: deps.logger }),
    registerApproveRecoveryPlanTool(server, lifecycleDeps),
    registerRejectRecoveryPlanTool(server, {
      recoveryPlanRepository: deps.recoveryPlanRepository,
      actionHistoryRepository: deps.actionHistoryRepository,
      logger: deps.logger,
    }),
    registerApplyApprovedPlanTool(server, lifecycleDeps),
    registerGetActionHistoryTool(server, {
      actionHistoryRepository: deps.actionHistoryRepository,
      logger: deps.logger,
    }),
  ];

  return { server, toolNames };
}
