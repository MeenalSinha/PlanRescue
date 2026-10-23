import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import { type RecoveryPlan } from '../recovery/types.js';
import {
  type RecoveryPlanRepository,
  type ActionHistoryRepository,
} from '../types.js';
import type { Logger } from '../logger.js';
import { failureResult, textError } from './recoveryShared.js';

export const REJECT_RECOVERY_PLAN_TOOL = 'reject_recovery_plan';

export interface RejectRecoveryPlanDeps {
  recoveryPlanRepository: RecoveryPlanRepository;
  actionHistoryRepository: ActionHistoryRepository;
  logger: Logger;
}

export const rejectRecoveryPlanInputSchema = z.object({
  planId: z.string().min(1).describe('Persistent server-generated recovery plan ID to reject or cancel.'),
  reason: z.string().optional().describe('Optional user reason for rejection/cancellation.'),
  actor: z.string().optional().default('local-user').describe('Actor recording the rejection.'),
});

export const rejectRecoveryPlanOutputSchema = z.object({
  planId: z.string(),
  status: z.literal('rejected'),
  rejectedAt: z.string(),
  strategy: z.string(),
  message: z.string(),
});

export function registerRejectRecoveryPlanTool(server: McpServer, deps: RejectRecoveryPlanDeps): string {
  const { logger, recoveryPlanRepository, actionHistoryRepository } = deps;

  server.registerTool(
    REJECT_RECOVERY_PLAN_TOOL,
    {
      title: 'Reject recovery plan',
      description:
        'Reject a proposed recovery plan or cancel an approved recovery plan before it has been applied. ' +
        'Transitions status to "rejected". A rejected plan cannot subsequently be applied. ' +
        'Idempotent: if already rejected, returns existing rejected state. ' +
        'THIS TOOL NEVER MODIFIES CALENDAR EVENTS.',
      inputSchema: withValidationReporting(rejectRecoveryPlanInputSchema, (issues) =>
        logger.warn(`Tool: ${REJECT_RECOVERY_PLAN_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: rejectRecoveryPlanOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ planId, reason, actor }) => {
      const started = performance.now();
      logger.info(`Tool: ${REJECT_RECOVERY_PLAN_TOOL} | Plan ID: ${planId}`);

      try {
        const stored = await recoveryPlanRepository.getPlan(planId);
        if (!stored) {
          return textError(`Recovery plan with ID "${planId}" does not exist.`);
        }

        const candidate = JSON.parse(stored.planJson) as RecoveryPlan;

        // Idempotency: if already rejected, return success
        if (stored.status === 'rejected') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Recovery plan ${planId} was already rejected (at ${stored.rejectedAt ?? stored.updatedAt}).`,
              },
            ],
            structuredContent: {
              planId: stored.id,
              status: 'rejected' as const,
              rejectedAt: stored.rejectedAt ?? stored.updatedAt,
              strategy: candidate.strategy,
              message: `Recovery plan ${planId} was already rejected.`,
            },
          };
        }

        // Cannot reject applied plans
        if (stored.status === 'applied') {
          return textError(
            `Cannot reject recovery plan ${planId}: it has already been applied to the calendar.`,
          );
        }

        const previousStatus = stored.status;
        const updated = await recoveryPlanRepository.updatePlanStatus(planId, 'rejected', {
          expectedStatus: ['proposed', 'approved', 'stale'],
        });

        const actionType = previousStatus === 'approved' ? 'approval_cancelled' : 'plan_rejected';
        await actionHistoryRepository.recordAction({
          id: randomUUID(),
          recoveryPlanId: planId,
          actionType,
          actor,
          detailsJson: JSON.stringify({
            previousStatus,
            reason: reason ?? 'User rejected proposal',
          }),
        });

        logger.info(
          `Tool: ${REJECT_RECOVERY_PLAN_TOOL} | Plan ${planId} rejected | Previous: ${previousStatus} | ${(performance.now() - started).toFixed(1)}ms`,
        );

        const response = {
          planId: updated.id,
          status: 'rejected' as const,
          rejectedAt: updated.rejectedAt!,
          strategy: candidate.strategy,
          message: `Recovery plan ${planId} was successfully rejected and cannot be applied. Calendar remains unchanged.`,
        };

        return {
          content: [{ type: 'text' as const, text: response.message }],
          structuredContent: response,
        };
      } catch (error) {
        return failureResult(logger, REJECT_RECOVERY_PLAN_TOOL, error);
      }
    },
  );

  return REJECT_RECOVERY_PLAN_TOOL;
}
