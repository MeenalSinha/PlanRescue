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

export const SAVE_RECOVERY_PLANS_TOOL = 'save_recovery_plans';

export interface SaveRecoveryPlansDeps {
  repository: ScheduleRepository;
  taskRepository: TaskRepository;
  recoveryPlanRepository: RecoveryPlanRepository;
  actionHistoryRepository: ActionHistoryRepository;
  logger: Logger;
}

export const saveRecoveryPlansInputSchema = z.object({
  requestId: z
    .string()
    .min(1)
    .max(128)
    .describe('Unique proposal request ID for idempotency.'),
  plans: z
    .array(recoveryPlanSchema)
    .min(1)
    .max(10)
    .describe('Candidate recovery plans returned by propose_recovery_plan.'),
});

export const savedPlanSummarySchema = z.object({
  id: z.string().describe('Server-generated persistent recovery-plan ID'),
  sourcePlanId: z.string().describe('Candidate ID from Recovery Engine'),
  requestId: z.string(),
  status: z.enum(['proposed', 'approved', 'rejected', 'applied', 'stale']),
  strategy: z.string(),
  score: z.number(),
  createdAt: z.string(),
  isValid: z.boolean(),
  summary: z.string(),
});

export const saveRecoveryPlansOutputSchema = z.object({
  requestId: z.string(),
  count: z.number(),
  plans: z.array(savedPlanSummarySchema),
  message: z.string(),
});

export type SaveRecoveryPlansOutput = z.infer<typeof saveRecoveryPlansOutputSchema>;

export function registerSaveRecoveryPlansTool(server: McpServer, deps: SaveRecoveryPlansDeps): string {
  const { logger, recoveryPlanRepository, actionHistoryRepository } = deps;

  server.registerTool(
    SAVE_RECOVERY_PLANS_TOOL,
    {
      title: 'Save recovery plans',
      description:
        'Persist candidate recovery plans returned by propose_recovery_plan into SQLite. ' +
        'Independently re-validates each candidate against the current calendar and tasks. ' +
        'Rejects the entire batch if any candidate fails hard constraints. ' +
        'Captures a deterministic SHA-256 snapshot hash of the underlying schedule for stale-plan detection. ' +
        'Records a plan_saved entry in the persistent action history. ' +
        'This tool is persistent and idempotent for a given requestId. It NEVER modifies calendar events.',
      inputSchema: withValidationReporting(saveRecoveryPlansInputSchema, (issues) =>
        logger.warn(`Tool: ${SAVE_RECOVERY_PLANS_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: saveRecoveryPlansOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ requestId, plans }) => {
      const started = performance.now();
      logger.info(`Tool: ${SAVE_RECOVERY_PLANS_TOOL} | Request ID: ${requestId} | Plans: ${plans.length}`);

      try {
        // Check for existing plans for idempotency
        const existingPlans = await recoveryPlanRepository.findPlans({ requestId });
        if (existingPlans.length > 0) {
          logger.info(`Tool: ${SAVE_RECOVERY_PLANS_TOOL} | Idempotent hit: ${existingPlans.length} existing plans`);
          const planSummaries = existingPlans.map((sp) => {
            const parsed = JSON.parse(sp.planJson) as RecoveryPlan;
            return {
              id: sp.id,
              sourcePlanId: sp.sourcePlanId,
              requestId: sp.requestId,
              status: sp.status,
              strategy: parsed.strategy,
              score: parsed.score.total,
              createdAt: sp.createdAt,
              isValid: parsed.validation.isValid,
              summary: parsed.summary,
            };
          });

          const output: SaveRecoveryPlansOutput = {
            requestId,
            count: planSummaries.length,
            plans: planSummaries,
            message: `Retrieved ${planSummaries.length} existing saved recovery plan(s) for request ${requestId}.`,
          };

          return {
            content: [{ type: 'text' as const, text: output.message }],
            structuredContent: output,
          };
        }

        // Validate each candidate against the current schedule
        const toSave = [];
        const planSummaries: z.infer<typeof savedPlanSummarySchema>[] = [];

        for (const candidate of plans) {
          const { events, tasks } = await loadPlanningData(deps, candidate.startTime, candidate.endTime);
          const validation = validateRecoveryPlan(candidate, { events, tasks });

          if (!validation.isValid) {
            logger.warn(
              `Tool: ${SAVE_RECOVERY_PLANS_TOOL} | Rejected candidate ${candidate.planId}: ${validation.violations.length} violations`,
            );
            return textError(
              `Candidate plan "${candidate.planId}" failed independent validation: ${validation.violations.map((v) => v.message).join('; ')}`,
            );
          }

          const snapshotHash = computeSnapshotHash(events, tasks);
          const planId = randomUUID();

          toSave.push({
            id: planId,
            requestId,
            sourcePlanId: candidate.planId,
            status: 'proposed' as const,
            planJson: JSON.stringify(candidate),
            planningStart: candidate.startTime,
            planningEnd: candidate.endTime,
            snapshotHash,
          });

          planSummaries.push({
            id: planId,
            sourcePlanId: candidate.planId,
            requestId,
            status: 'proposed',
            strategy: candidate.strategy,
            score: candidate.score.total,
            createdAt: new Date().toISOString(),
            isValid: true,
            summary: candidate.summary,
          });
        }

        // Save each plan and record action history
        for (const planToSave of toSave) {
          const saved = await recoveryPlanRepository.savePlan(planToSave);
          await actionHistoryRepository.recordAction({
            id: randomUUID(),
            recoveryPlanId: saved.id,
            actionType: 'plan_saved',
            actor: 'local-user',
            detailsJson: JSON.stringify({
              requestId: saved.requestId,
              sourcePlanId: saved.sourcePlanId,
              snapshotHash: saved.snapshotHash,
              planningStart: saved.planningStart,
              planningEnd: saved.planningEnd,
            }),
          });
        }

        logger.info(
          `Tool: ${SAVE_RECOVERY_PLANS_TOOL} | Saved ${toSave.length} plans | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );

        const output: SaveRecoveryPlansOutput = {
          requestId,
          count: toSave.length,
          plans: planSummaries,
          message: `Successfully saved ${toSave.length} candidate recovery plan(s) with status "proposed".`,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: `${output.message}\n` + planSummaries.map((p) => `- [${p.status.toUpperCase()}] ${p.id} (${p.strategy}, score ${p.score})`).join('\n'),
            },
          ],
          structuredContent: output,
        };
      } catch (error) {
        return failureResult(logger, SAVE_RECOVERY_PLANS_TOOL, error);
      }
    },
  );

  return SAVE_RECOVERY_PLANS_TOOL;
}
