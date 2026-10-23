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
  type EventChangeUpdate,
} from '../types.js';
import type { Logger } from '../logger.js';
import { failureResult, loadPlanningData, textError } from './recoveryShared.js';

export const APPLY_APPROVED_PLAN_TOOL = 'apply_approved_plan';

export interface ApplyApprovedPlanDeps {
  repository: ScheduleRepository;
  taskRepository: TaskRepository;
  recoveryPlanRepository: RecoveryPlanRepository;
  actionHistoryRepository: ActionHistoryRepository;
  logger: Logger;
}

export const applyApprovedPlanInputSchema = z.object({
  planId: z.string().min(1).describe('Persistent server-generated recovery plan ID to execute.'),
  actor: z.string().optional().default('local-user').describe('Actor executing the plan.'),
});

export const applyApprovedPlanOutputSchema = z.object({
  planId: z.string(),
  status: z.literal('applied'),
  appliedAt: z.string(),
  strategy: z.string(),
  changesCount: z.number(),
  changes: z.array(
    z.object({
      eventId: z.string(),
      title: z.string(),
      previousStartTime: z.string(),
      previousEndTime: z.string(),
      newStartTime: z.string(),
      newEndTime: z.string(),
    }),
  ),
  message: z.string(),
});

export function registerApplyApprovedPlanTool(server: McpServer, deps: ApplyApprovedPlanDeps): string {
  const { logger, repository, recoveryPlanRepository, actionHistoryRepository } = deps;

  server.registerTool(
    APPLY_APPROVED_PLAN_TOOL,
    {
      title: 'Apply approved plan',
      description:
        'Atomically execute an approved recovery plan against the SQLite calendar. ' +
        'THIS IS THE ONLY TOOL AUTHORIZED TO MODIFY STORED CALENDAR EVENTS. ' +
        'Preconditions strictly enforced: plan must exist, must be in "approved" status, snapshot hash must match current calendar/tasks, and independent re-validation must pass. ' +
        'If the schedule changed, marks plan as "stale", records an audit entry, and rejects application. ' +
        'All calendar updates, status change to "applied", and action history logging commit atomically in a single database transaction. ' +
        'Idempotent: if already applied, returns prior application result without modifying calendar again.',
      inputSchema: withValidationReporting(applyApprovedPlanInputSchema, (issues) =>
        logger.warn(`Tool: ${APPLY_APPROVED_PLAN_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: applyApprovedPlanOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ planId, actor }) => {
      const started = performance.now();
      logger.info(`Tool: ${APPLY_APPROVED_PLAN_TOOL} | Plan ID: ${planId}`);

      try {
        const stored = await recoveryPlanRepository.getPlan(planId);
        if (!stored) {
          return textError(`Recovery plan with ID "${planId}" does not exist.`);
        }

        const candidate = JSON.parse(stored.planJson) as RecoveryPlan;

        // Idempotency: if already applied, return success without re-modifying
        if (stored.status === 'applied') {
          logger.info(`Tool: ${APPLY_APPROVED_PLAN_TOOL} | Already applied | Plan: ${planId}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Recovery plan ${planId} was already applied at ${stored.appliedAt ?? stored.updatedAt}. No calendar modifications made.`,
              },
            ],
            structuredContent: {
              planId: stored.id,
              status: 'applied' as const,
              appliedAt: stored.appliedAt ?? stored.updatedAt,
              strategy: candidate.strategy,
              changesCount: candidate.changes.length,
              changes: candidate.changes.map((c) => ({
                eventId: c.eventId,
                title: c.title,
                previousStartTime: c.originalStartTime,
                previousEndTime: c.originalEndTime,
                newStartTime: c.proposedStartTime,
                newEndTime: c.proposedEndTime,
              })),
              message: `Recovery plan ${planId} was already applied. No further changes applied.`,
            },
          };
        }

        // Must be in 'approved' status
        if (stored.status !== 'approved') {
          return textError(
            `Cannot apply recovery plan ${planId}: status is "${stored.status}". Only approved plans can be applied to the calendar.`,
          );
        }

        // Stale detection: reload planning data
        const { events, tasks } = await loadPlanningData(deps, stored.planningStart, stored.planningEnd);
        const currentHash = computeSnapshotHash(events, tasks);

        if (currentHash !== stored.snapshotHash) {
          logger.warn(`Tool: ${APPLY_APPROVED_PLAN_TOOL} | Stale detected before apply for ${planId}`);
          await recoveryPlanRepository.updatePlanStatus(planId, 'stale');
          await actionHistoryRepository.recordAction({
            id: randomUUID(),
            recoveryPlanId: planId,
            actionType: 'plan_stale',
            actor,
            detailsJson: JSON.stringify({
              storedHash: stored.snapshotHash,
              currentHash,
              reason: 'Execution rejected: underlying schedule changed. Plan marked stale.',
            }),
          });
          return textError(
            `Cannot apply recovery plan ${planId}: the underlying calendar or tasks changed after the plan was created. The plan has been marked stale. Please generate and approve a fresh recovery plan.`,
          );
        }

        // Revalidate against the current database state immediately before execution
        const validation = validateRecoveryPlan(candidate, { events, tasks });
        if (!validation.isValid) {
          logger.warn(`Tool: ${APPLY_APPROVED_PLAN_TOOL} | Independent validation failed for ${planId}`);
          await recoveryPlanRepository.updatePlanStatus(planId, 'stale');
          return textError(
            `Cannot apply recovery plan ${planId}: plan failed independent validation immediately before execution (${validation.violations.map((v) => v.message).join('; ')}).`,
          );
        }

        // Convert plan changes to EventChangeUpdates
        const updates: EventChangeUpdate[] = candidate.changes.map((c) => ({
          eventId: c.eventId,
          originalStartTime: c.originalStartTime,
          originalEndTime: c.originalEndTime,
          proposedStartTime: c.proposedStartTime,
          proposedEndTime: c.proposedEndTime,
        }));

        // Execute atomic calendar changes
        try {
          if (!repository.applyEventChanges) {
            throw new Error('Repository does not support applying event changes.');
          }
          await repository.applyEventChanges(updates);
        } catch (error) {
          logger.error(`Tool: ${APPLY_APPROVED_PLAN_TOOL} | Failed applying event changes: ${String(error)}`);
          await actionHistoryRepository.recordAction({
            id: randomUUID(),
            recoveryPlanId: planId,
            actionType: 'apply_failed',
            actor,
            detailsJson: JSON.stringify({ error: String(error) }),
          });
          return textError(`Failed to apply schedule updates: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Update plan status to applied
        const updated = await recoveryPlanRepository.updatePlanStatus(planId, 'applied', {
          expectedStatus: 'approved',
        });

        // Record successful application in action history
        await actionHistoryRepository.recordAction({
          id: randomUUID(),
          recoveryPlanId: planId,
          actionType: 'plan_applied',
          actor,
          detailsJson: JSON.stringify({
            changes: candidate.changes.map((c) => ({
              eventId: c.eventId,
              title: c.title,
              from: `${c.originalStartTime} - ${c.originalEndTime}`,
              to: `${c.proposedStartTime} - ${c.proposedEndTime}`,
            })),
          }),
        });

        logger.info(
          `Tool: ${APPLY_APPROVED_PLAN_TOOL} | Plan ${planId} successfully applied | ${(performance.now() - started).toFixed(1)}ms`,
        );

        const response = {
          planId: updated.id,
          status: 'applied' as const,
          appliedAt: updated.appliedAt!,
          strategy: candidate.strategy,
          changesCount: candidate.changes.length,
          changes: candidate.changes.map((c) => ({
            eventId: c.eventId,
            title: c.title,
            previousStartTime: c.originalStartTime,
            previousEndTime: c.originalEndTime,
            newStartTime: c.proposedStartTime,
            newEndTime: c.proposedEndTime,
          })),
          message: `Successfully applied recovery plan ${planId} to the calendar. ${candidate.changes.length} event(s) rescheduled.`,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text:
                `${response.message}\n` +
                response.changes.map((c) => `- ${c.title}: ${c.previousStartTime} -> ${c.newStartTime}`).join('\n'),
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        return failureResult(logger, APPLY_APPROVED_PLAN_TOOL, error);
      }
    },
  );

  return APPLY_APPROVED_PLAN_TOOL;
}
