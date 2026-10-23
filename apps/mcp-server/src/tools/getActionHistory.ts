import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import {
  type ActionHistoryRepository,
  type ActionType,
  ACTION_TYPES,
} from '../types.js';
import type { Logger } from '../logger.js';
import { failureResult } from './recoveryShared.js';

export const GET_ACTION_HISTORY_TOOL = 'get_action_history';

export interface GetActionHistoryDeps {
  actionHistoryRepository: ActionHistoryRepository;
  logger: Logger;
}

export const getActionHistoryInputSchema = z.object({
  recoveryPlanId: z.string().optional().describe('Filter by persistent recovery plan ID.'),
  actionType: z.enum(ACTION_TYPES).optional().describe('Filter by action type.'),
  limit: z.number().int().min(1).max(100).optional().default(50).describe('Max records to return.'),
});

export const actionHistoryEntrySchema = z.object({
  id: z.string(),
  recoveryPlanId: z.string().optional(),
  actionType: z.enum(ACTION_TYPES),
  occurredAt: z.string(),
  actor: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.any()),
});

export const getActionHistoryOutputSchema = z.object({
  count: z.number(),
  entries: z.array(actionHistoryEntrySchema),
});

export type GetActionHistoryOutput = z.infer<typeof getActionHistoryOutputSchema>;

export function registerGetActionHistoryTool(server: McpServer, deps: GetActionHistoryDeps): string {
  const { logger, actionHistoryRepository } = deps;

  server.registerTool(
    GET_ACTION_HISTORY_TOOL,
    {
      title: 'Get action history',
      description:
        'Query the persistent, append-only action audit trail. ' +
        'Returns lifecycle actions (plan_saved, plan_approved, plan_rejected, plan_applied, plan_stale, apply_failed, approval_cancelled) ' +
        'in chronological order with detailed before/after metadata.',
      inputSchema: withValidationReporting(getActionHistoryInputSchema, (issues) =>
        logger.warn(`Tool: ${GET_ACTION_HISTORY_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: getActionHistoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ recoveryPlanId, actionType, limit }) => {
      const started = performance.now();
      logger.info(
        `Tool: ${GET_ACTION_HISTORY_TOOL} | recoveryPlanId: ${recoveryPlanId ?? 'all'} | actionType: ${actionType ?? 'all'}`,
      );

      try {
        const rows = await actionHistoryRepository.findActions({
          recoveryPlanId,
          actionType: actionType as ActionType | undefined,
          limit,
        });

        const formatted = rows.map((r) => {
          let parsedDetails: Record<string, unknown> = {};
          try {
            parsedDetails = r.detailsJson ? (JSON.parse(r.detailsJson) as Record<string, unknown>) : {};
          } catch {
            parsedDetails = { raw: r.detailsJson };
          }

          const summary =
            r.actionType === 'plan_saved'
              ? `Plan saved (${r.recoveryPlanId})`
              : r.actionType === 'plan_approved'
                ? `Plan approved (${r.recoveryPlanId})`
                : r.actionType === 'plan_applied'
                  ? `Plan applied to calendar (${r.recoveryPlanId})`
                  : r.actionType === 'plan_rejected'
                    ? `Plan rejected (${r.recoveryPlanId})`
                    : r.actionType === 'approval_cancelled'
                      ? `Plan approval cancelled (${r.recoveryPlanId})`
                      : r.actionType === 'plan_stale'
                        ? `Plan marked stale (${r.recoveryPlanId})`
                        : `Plan execution failed (${r.recoveryPlanId})`;

          return {
            id: r.id,
            recoveryPlanId: r.recoveryPlanId,
            actionType: r.actionType,
            occurredAt: r.occurredAt,
            actor: r.actor,
            summary,
            details: parsedDetails,
          };
        });

        logger.info(
          `Tool: ${GET_ACTION_HISTORY_TOOL} | Found ${formatted.length} entries | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );

        const summaryText =
          formatted.length === 0
            ? 'No action history records found.'
            : `Action history (${formatted.length} entries):\n` +
              formatted
                .map((e) => `[${e.occurredAt}] [${e.actionType.toUpperCase()}] ${e.summary} (Actor: ${e.actor})`)
                .join('\n');

        return {
          content: [{ type: 'text' as const, text: summaryText }],
          structuredContent: {
            count: formatted.length,
            entries: formatted,
          },
        };
      } catch (error) {
        return failureResult(logger, GET_ACTION_HISTORY_TOOL, error);
      }
    },
  );

  return GET_ACTION_HISTORY_TOOL;
}
