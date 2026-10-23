import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import { validateRecoveryPlan } from '../recovery/validateRecoveryPlan.js';
import { recoveryPlanSchema, type RecoveryPlan } from '../recovery/types.js';
import { computeSnapshotHash } from '../data/snapshotHash.js';
import {
  type ScheduleRepository,
  type TaskRepository,
  type RecoveryPlanRepository,
  type ActionHistoryRepository,
} from '../types.js';
import type { Logger } from '../logger.js';
import { failureResult, loadPlanningData, textError } from './recoveryShared.js';

export const APPROVE_RECOVERY_PLAN_TOOL = 'approve_recovery_plan';

export interface ApproveRecoveryPlanDeps {
  repository: ScheduleRepository;
  taskRepository: TaskRepository;
  recoveryPlanRepository: RecoveryPlanRepository;
  actionHistoryRepository: ActionHistoryRepository;
  logger: Logger;
}

export const approveRecoveryPlanInputSchema = z.object({
  planId: z.string().min(1).describe('Persistent server-generated recovery plan ID to approve.'),
  actor: z.string().optional().default('local-user').describe('Actor recording the approval.'),
});

export const approveRecoveryPlanOutputSchema = z.object({
  planId: z.string(),
  status: z.literal('approved'),
  approvedAt: z.string(),
  strategy: z.string(),
  summary: z.string(),
  message: z.string(),
});

export function registerApproveRecoveryPlanTool(server: McpServer, deps: ApproveRecoveryPlanDeps): string {
  const { logger, recoveryPlanRepository, actionHistoryRepository } = deps;

  server.registerTool(
    APPROVE_RECOVERY_PLAN_TOOL,
    {
      title: 'Approve recovery plan',
      description:
        'Transition a persistent recovery plan from "proposed" to "approved". ' +
        'Re-verifies that the schedule snapshot has not changed (stale detection) and that the plan remains independently valid. ' +
        'If the schedule changed, marks the plan as "stale" and rejects approval. ' +
        'Idempotent: if already approved, returns existing approved state. ' +
        'THIS TOOL NEVER APPLIES CHANGES TO THE CALENDAR. Approving only marks the plan ready for subsequent explicit application.',
      inputSchema: withValidationReporting(approveRecoveryPlanInputSchema, (issues) =>
        logger.warn(`Tool: ${APPROVE_RECOVERY_PLAN_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: approveRecoveryPlanOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ planId, actor }) => {
      const started = performance.now();
      logger.info(`Tool: ${APPROVE_RECOVERY_PLAN_TOOL} | Plan ID: ${planId}`);

      try {
        const stored = await recoveryPlanRepository.getPlan(planId);
        if (!stored) {
          return textError(`Recovery plan with ID "${planId}" does not exist.`);
        }

        const candidate = JSON.parse(stored.planJson) as RecoveryPlan;

        // Idempotency: if already approved, return success
        if (stored.status === 'approved') {
          logger.info(`Tool: ${APPROVE_RECOVERY_PLAN_TOOL} | Already approved | Plan: ${planId}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Recovery plan ${planId} is already approved (approved at ${stored.approvedAt ?? stored.updatedAt}). The calendar has NOT changed yet.`,
              },
            ],
            structuredContent: {
              planId: stored.id,
              status: 'approved' as const,
              approvedAt: stored.approvedAt ?? stored.updatedAt,
              strategy: candidate.strategy,
              summary: candidate.summary,
              message: `Recovery plan ${planId} was already approved. The calendar has NOT changed yet.`,
            },
          };
        }

        // State machine validation
        if (stored.status !== 'proposed') {
          return textError(
            `Cannot approve recovery plan ${planId} with status "${stored.status}". Only plans in "proposed" status can be approved.`,
          );
        }

        // Reload planning data and check for stale snapshot
        const { events, tasks } = await loadPlanningData(deps, stored.planningStart, stored.planningEnd);
        const currentHash = computeSnapshotHash(events, tasks);

        if (currentHash !== stored.snapshotHash) {
          logger.warn(`Tool: ${APPROVE_RECOVERY_PLAN_TOOL} | Stale detected for ${planId}`);
          await recoveryPlanRepository.updatePlanStatus(planId, 'stale');
          await actionHistoryRepository.recordAction({
            id: randomUUID(),
            recoveryPlanId: planId,
            actionType: 'plan_stale',
            actor,
            detailsJson: JSON.stringify({
              storedHash: stored.snapshotHash,
              currentHash,
              reason: 'Underlying schedule changed during approval',
            }),
          });
          return textError(
            `Cannot approve recovery plan ${planId}: the underlying schedule or tasks changed since the plan was proposed. The plan has been marked stale. Please generate a fresh plan.`,
          );
        }

        // Revalidate independently
        const validation = validateRecoveryPlan(candidate, { events, tasks });
        if (!validation.isValid) {
          logger.warn(`Tool: ${APPROVE_RECOVERY_PLAN_TOOL} | Plan ${planId} is no longer valid`);
          await recoveryPlanRepository.updatePlanStatus(planId, 'stale');
          return textError(
            `Cannot approve recovery plan ${planId}: independent re-validation failed (${validation.violations.map((v) => v.message).join('; ')}).`,
          );
        }

        // Transition to approved
        const updated = await recoveryPlanRepository.updatePlanStatus(planId, 'approved', {
          expectedStatus: 'proposed',
        });

        // Append action history
        await actionHistoryRepository.recordAction({
          id: randomUUID(),
          recoveryPlanId: planId,
          actionType: 'plan_approved',
          actor,
          detailsJson: JSON.stringify({
            changesCount: candidate.changes.length,
            score: candidate.score.total,
          }),
        });

        logger.info(
          `Tool: ${APPROVE_RECOVERY_PLAN_TOOL} | Plan ${planId} approved successfully | ${(performance.now() - started).toFixed(1)}ms`,
        );

        const response = {
          planId: updated.id,
          status: 'approved' as const,
          approvedAt: updated.approvedAt!,
          strategy: candidate.strategy,
          summary: candidate.summary,
          message: `Recovery plan ${planId} successfully approved. Calendar events have NOT been modified yet. Explicit execution is required to apply changes.`,
        };

        return {
          content: [{ type: 'text' as const, text: response.message }],
          structuredContent: response,
        };
      } catch (error) {
        return failureResult(logger, APPROVE_RECOVERY_PLAN_TOOL, error);
      }
    },
  );

  return APPROVE_RECOVERY_PLAN_TOOL;
}
