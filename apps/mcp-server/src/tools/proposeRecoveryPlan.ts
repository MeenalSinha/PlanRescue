import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { isoWithOffset } from '../lib/time.js';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import { generateRecoveryPlans } from '../recovery/generateRecoveryPlans.js';
import { disruptionSchema, planSetSchema, protectedEventIdsSchema, rankingPreferencesSchema, type RecoveryPlanSet } from '../recovery/types.js';
import { failureResult, loadPlanningData, RECOVERY_TOOL_ANNOTATIONS, type RecoveryToolDeps } from './recoveryShared.js';

export const PROPOSE_RECOVERY_PLAN_TOOL = 'propose_recovery_plan';

export const proposeRecoveryPlanInputSchema = z.object({
  startTime: isoWithOffset.describe(
    'Start of the planning interval, ISO 8601 with explicit UTC offset, e.g. 2026-10-22T08:00:00+05:30. Rescheduled events must stay inside the interval; also treated as "now" for task-capacity calculations.',
  ),
  endTime: isoWithOffset.describe('End of the planning interval, ISO 8601 with explicit UTC offset; after startTime, at most 14 days later.'),
  disruption: disruptionSchema.describe('The disruption to recover from: which event overran, and by how many minutes.'),
  protectedEventIds: protectedEventIdsSchema.optional(),
  preferences: rankingPreferencesSchema.optional().describe('Optional ranking preferences. They reorder candidates and never relax a hard constraint.'),
});

export function formatPlanSetText(set: RecoveryPlanSet): string {
  const lines = [set.summary];
  for (const plan of set.candidates) {
    lines.push('', `#${plan.score.rank} ${plan.strategy} | ${plan.planId} | score ${plan.score.total} (lower is better) | independently validated: ${plan.validation.isValid ? 'yes' : 'NO'}`);
    if (plan.changes.length === 0) lines.push('  No events move.');
    for (const c of plan.changes) lines.push(`  - ${c.title}: ${c.originalStartTime} to ${c.originalEndTime}  ->  ${c.proposedStartTime} to ${c.proposedEndTime}`);
    for (const e of plan.unchangedProtectedEvents) lines.push(`  = unchanged: ${e.title} ${e.startTime} to ${e.endTime} (${e.reasons.join(', ').replace(/_/g, ' ')})`);
    for (const note of plan.explanation.taskCapacity.slice(0, 1)) lines.push(`  Task capacity: ${note}`);
    for (const note of plan.explanation.limitations.slice(0, -3)) lines.push(`  Note: ${note}`);
  }
  if (set.discardedStrategies.length > 0) {
    lines.push('', 'Strategies not offered:');
    for (const d of set.discardedStrategies) lines.push(`  - ${d.strategy}: ${d.reason}`);
  }
  if (set.infeasibility) lines.push('', set.infeasibility.summary);
  for (const w of set.warnings) lines.push('', `Warning: ${w}`);
  lines.push('', 'This is a proposal only. Nothing has been changed in the calendar.');
  return lines.join('\n');
}

/** Register the propose_recovery_plan tool on an MCP server. */
export function registerProposeRecoveryPlanTool(server: McpServer, deps: RecoveryToolDeps): string {
  const { logger } = deps;

  server.registerTool(
    PROPOSE_RECOVERY_PLAN_TOOL,
    {
      title: 'Propose recovery plan',
      description:
        'Generate deterministic, independently validated schedule alternatives after an event runs late (disruption type "event_overrun"). ' +
        'The overrunning event keeps its start and ends later; other events are moved only when they must be. ' +
        'Hard rules: immovable events, critical events and caller-protected events never move; every moved event keeps its duration, is only ever moved later, and stays inside the planning interval; the resulting schedule has no overlaps and introduces no new task-deadline infeasibility. ' +
        'Each candidate lists its changes relative to the stored schedule, what stays unchanged, a deterministic score (lower is better), an explanation derived from the computed schedule, and the result of an independent validation. Candidates are ranked; rank 1 is recommended. ' +
        'If no plan satisfies every hard constraint the result says so and explains why; constraints are never silently relaxed. ' +
        'This is a proposal only: nothing is written to the calendar. Pass a candidate unchanged to validate_recovery_plan to re-verify it.',
      inputSchema: withValidationReporting(proposeRecoveryPlanInputSchema, (issues) =>
        logger.warn(`Tool: ${PROPOSE_RECOVERY_PLAN_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: planSetSchema,
      annotations: RECOVERY_TOOL_ANNOTATIONS,
    },
    async ({ startTime, endTime, disruption, protectedEventIds, preferences }) => {
      const started = performance.now();
      logger.info(
        `Tool: ${PROPOSE_RECOVERY_PLAN_TOOL} | Interval: [${startTime}, ${endTime}) | Disruption: ${disruption.type} ${disruption.eventId} +${disruption.overrunMinutes}min | Protected IDs: ${protectedEventIds?.length ?? 0}`,
      );
      try {
        const { events, tasks } = await loadPlanningData(deps, startTime, endTime);
        const output = generateRecoveryPlans({ startTime, endTime, events, tasks, disruption, protectedEventIds, preferences });
        logger.info(
          `Tool: ${PROPOSE_RECOVERY_PLAN_TOOL} | Outcome: ${output.outcome} | Validated candidates: ${output.candidates.length} | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );
        return { content: [{ type: 'text' as const, text: formatPlanSetText(output) }], structuredContent: output };
      } catch (error) {
        return failureResult(logger, PROPOSE_RECOVERY_PLAN_TOOL, error);
      }
    },
  );

  return PROPOSE_RECOVERY_PLAN_TOOL;
}
