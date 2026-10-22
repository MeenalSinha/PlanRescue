import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { isoWithOffset } from '../lib/time.js';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import { analyzeConflicts } from '../recovery/analyzeConflicts.js';
import { conflictAnalysisSchema, disruptionSchema, protectedEventIdsSchema, type ConflictAnalysis } from '../recovery/types.js';
import { failureResult, loadPlanningData, RECOVERY_TOOL_ANNOTATIONS, type RecoveryToolDeps } from './recoveryShared.js';

export const ANALYZE_CONFLICTS_TOOL = 'analyze_conflicts';

export const analyzeConflictsInputSchema = z.object({
  startTime: isoWithOffset.describe(
    'Start of the planning interval, ISO 8601 with explicit UTC offset, e.g. 2026-10-22T08:00:00+05:30. Also treated as "now" for task-capacity calculations.',
  ),
  endTime: isoWithOffset.describe(
    'End of the planning interval, ISO 8601 with explicit UTC offset; must be after startTime and at most 14 days later. Tasks due after it are not assessed.',
  ),
  disruption: disruptionSchema
    .optional()
    .describe('Optional hypothetical disruption to analyse. Omit to analyse the stored schedule as it is.'),
  protectedEventIds: protectedEventIdsSchema.optional(),
});

/** Readable rendering returned alongside the structured result. */
export function formatAnalysisText(a: ConflictAnalysis): string {
  const lines = [a.assessment.summary];
  const list = (title: string, items: ConflictAnalysis['existingConflicts']): void => {
    if (items.length === 0) return;
    lines.push('', `${title}:`);
    for (const c of items) lines.push(`- [${c.severity}] ${c.description} ${c.resolvable ? '' : '(appears unresolvable) '}Next: ${c.suggestedNextStep}`.replace(/\s+/g, ' '));
  };
  list('Existing conflicts (present before any disruption)', a.existingConflicts);
  list('New conflicts (caused by the disruption)', a.newConflicts);
  if (a.affectedEvents.length > 0) {
    lines.push('', 'Affected events:');
    for (const e of a.affectedEvents) lines.push(`- ${e.title} (${e.impact.replace('_', ' ')}${e.canBeRescheduled ? '' : ', cannot be rescheduled'}) id ${e.eventId}`);
  }
  if (a.protectedConstraints.length > 0) {
    lines.push('', 'Events the planner will not move:');
    for (const p of a.protectedConstraints) lines.push(`- ${p.title} ${p.startTime} to ${p.endTime}: ${p.reasons.join(', ').replace(/_/g, ' ')}`);
  }
  if (a.taskAssessments.length > 0) {
    lines.push('', 'Task deadlines (aggregate capacity estimate; tasks are not assigned slots):');
    for (const t of a.taskAssessments) {
      lines.push(
        `- ${t.title} due ${t.deadline}: ${t.status.replace('_', ' ')}${t.origin !== 'none' ? ` (${t.origin.replace('_', '-')})` : ''}` +
          (t.slackMinutes !== null ? `, margin ${t.slackMinutes} min` : ''),
      );
    }
  }
  for (const w of a.warnings) lines.push('', `Warning: ${w}`);
  return lines.join('\n');
}

/** Register the analyze_conflicts tool on an MCP server. */
export function registerAnalyzeConflictsTool(server: McpServer, deps: RecoveryToolDeps): string {
  const { logger } = deps;

  server.registerTool(
    ANALYZE_CONFLICTS_TOOL,
    {
      title: 'Analyze conflicts',
      description:
        'Analyse the calendar for a planning interval: find overlapping events, and optionally project the consequences of an event running late (disruption type "event_overrun": the named event keeps its start and ends overrunMinutes later). ' +
        'Reports existing conflicts, conflicts newly caused by the disruption, which events are affected (directly or by cascade), which events cannot be moved (immovable, critical, user-protected, or the overrunning event), and whether unfinished tasks still have enough unoccupied calendar time before their deadlines. ' +
        'Deadline findings are an aggregate capacity estimate: tasks have no calendar slot and none is assigned. Read-only: the hypothetical disruption is applied to an in-memory copy and nothing is saved. ' +
        'All timestamps must be ISO 8601 with an explicit UTC offset.',
      inputSchema: withValidationReporting(analyzeConflictsInputSchema, (issues) =>
        logger.warn(`Tool: ${ANALYZE_CONFLICTS_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: conflictAnalysisSchema,
      annotations: RECOVERY_TOOL_ANNOTATIONS,
    },
    async ({ startTime, endTime, disruption, protectedEventIds }) => {
      const started = performance.now();
      logger.info(
        `Tool: ${ANALYZE_CONFLICTS_TOOL} | Interval: [${startTime}, ${endTime}) | Disruption: ${
          disruption ? `${disruption.type} ${disruption.eventId} +${disruption.overrunMinutes}min` : 'none'
        } | Protected IDs: ${protectedEventIds?.length ?? 0}`,
      );
      try {
        const { events, tasks } = await loadPlanningData(deps, startTime, endTime);
        const output = analyzeConflicts({ startTime, endTime, events, tasks, disruption, protectedEventIds });
        logger.info(
          `Tool: ${ANALYZE_CONFLICTS_TOOL} | Events: ${output.eventsExamined} | Existing conflicts: ${output.existingConflicts.length} | New conflicts: ${output.newConflicts.length} | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );
        return { content: [{ type: 'text' as const, text: formatAnalysisText(output) }], structuredContent: output };
      } catch (error) {
        return failureResult(logger, ANALYZE_CONFLICTS_TOOL, error);
      }
    },
  );

  return ANALYZE_CONFLICTS_TOOL;
}
