import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import {
  type RecoveryPlanRepository,
  type SavedRecoveryPlan,
  type RecoveryPlanStatus,
  RECOVERY_PLAN_STATUSES,
} from '../types.js';
import { recoveryPlanSchema, type RecoveryPlan } from '../recovery/types.js';
import type { Logger } from '../logger.js';
import { failureResult } from './recoveryShared.js';

export const GET_RECOVERY_PLANS_TOOL = 'get_recovery_plans';

export interface GetRecoveryPlansDeps {
  recoveryPlanRepository: RecoveryPlanRepository;
  logger: Logger;
}

export const getRecoveryPlansInputSchema = z.object({
  planId: z.string().optional().describe('Filter by persistent recovery plan ID.'),
  requestId: z.string().optional().describe('Filter by proposal request ID.'),
  status: z.enum(RECOVERY_PLAN_STATUSES).optional().describe('Filter by lifecycle status.'),
  limit: z.number().int().min(1).max(50).optional().default(20).describe('Max records to return.'),
});

export const retrievedPlanSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  sourcePlanId: z.string(),
  status: z.enum(RECOVERY_PLAN_STATUSES),
  plan: recoveryPlanSchema,
  planningStart: z.string(),
  planningEnd: z.string(),
  snapshotHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  appliedAt: z.string().optional(),
});

export const getRecoveryPlansOutputSchema = z.object({
  count: z.number(),
  plans: z.array(retrievedPlanSchema),
});

export type GetRecoveryPlansOutput = z.infer<typeof getRecoveryPlansOutputSchema>;

export function registerGetRecoveryPlansTool(server: McpServer, deps: GetRecoveryPlansDeps): string {
  const { logger, recoveryPlanRepository } = deps;

  server.registerTool(
    GET_RECOVERY_PLANS_TOOL,
    {
      title: 'Get recovery plans',
      description:
        'Retrieve previously saved recovery plans by ID, requestId, or status. ' +
        'Returns persistent plan details, lifecycle status, timestamps, and the original candidate payload.',
      inputSchema: withValidationReporting(getRecoveryPlansInputSchema, (issues) =>
        logger.warn(`Tool: ${GET_RECOVERY_PLANS_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: getRecoveryPlansOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ planId, requestId, status, limit }) => {
      const started = performance.now();
      logger.info(`Tool: ${GET_RECOVERY_PLANS_TOOL} | planId: ${planId ?? 'all'} | status: ${status ?? 'all'}`);

      try {
        let results: SavedRecoveryPlan[] = [];

        if (planId) {
          const single = await recoveryPlanRepository.getPlan(planId);
          if (single) {
            results = [single];
          }
        } else {
          results = await recoveryPlanRepository.findPlans({
            requestId,
            status: status as RecoveryPlanStatus | undefined,
            limit,
          });
        }

        const formatted = results.map((r) => ({
          id: r.id,
          requestId: r.requestId,
          sourcePlanId: r.sourcePlanId,
          status: r.status,
          plan: JSON.parse(r.planJson) as RecoveryPlan,
          planningStart: r.planningStart,
          planningEnd: r.planningEnd,
          snapshotHash: r.snapshotHash,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          approvedAt: r.approvedAt,
          rejectedAt: r.rejectedAt,
          appliedAt: r.appliedAt,
        }));

        logger.info(
          `Tool: ${GET_RECOVERY_PLANS_TOOL} | Found ${formatted.length} plans | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );

        const summaryText =
          formatted.length === 0
            ? 'No recovery plans matched the query.'
            : `Found ${formatted.length} recovery plan(s):\n` +
              formatted
                .map((p) => `- [${p.status.toUpperCase()}] ${p.id} (Source: ${p.sourcePlanId}, Updated: ${p.updatedAt})`)
                .join('\n');

        return {
          content: [{ type: 'text' as const, text: summaryText }],
          structuredContent: {
            count: formatted.length,
            plans: formatted,
          },
        };
      } catch (error) {
        return failureResult(logger, GET_RECOVERY_PLANS_TOOL, error);
      }
    },
  );

  return GET_RECOVERY_PLANS_TOOL;
}
