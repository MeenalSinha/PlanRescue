import type { McpServer } from '@modelcontextprotocol/server';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import { planPayloadSchema, validationResultSchema, type ValidationResult } from '../recovery/types.js';
import { validateRecoveryPlan } from '../recovery/validateRecoveryPlan.js';
import { failureResult, loadPlanningData, RECOVERY_TOOL_ANNOTATIONS, type RecoveryToolDeps } from './recoveryShared.js';

export const VALIDATE_RECOVERY_PLAN_TOOL = 'validate_recovery_plan';

export function formatValidationText(result: ValidationResult): string {
  const lines = [result.summary];
  if (result.violations.length > 0) {
    lines.push('', 'Hard violations:');
    for (const v of result.violations) lines.push(`- [${v.check}] ${v.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const w of result.warnings) lines.push(`- [${w.check}] ${w.message}`);
  }
  const failed = new Set(result.violations.map((v) => v.check));
  const passed = [...new Set(result.checks.filter((c) => c.passed).map((c) => c.name))].filter((n) => !failed.has(n));
  if (passed.length > 0) lines.push('', `Checks passed: ${passed.join(', ')}.`);
  return lines.join('\n');
}

/** Register the validate_recovery_plan tool on an MCP server. */
export function registerValidateRecoveryPlanTool(server: McpServer, deps: RecoveryToolDeps): string {
  const { logger } = deps;

  server.registerTool(
    VALIDATE_RECOVERY_PLAN_TOOL,
    {
      title: 'Validate recovery plan',
      description:
        'Independently verify a proposed recovery plan against the current calendar and tasks. ' +
        'Accepts a candidate exactly as returned by propose_recovery_plan (extra fields are ignored), or a hand-built payload with the planning interval (startTime, endTime), the disruption, the proposed changes and optional protectedEventIds. ' +
        'The validator trusts nothing the plan says about itself: it reloads the stored events and tasks, rebuilds the projected schedule from the disruption and the listed changes, and re-checks event existence, time-range validity, overlaps (half-open intervals), duration preservation, immovable, critical and protected events, task-deadline feasibility (separating pre-existing, disruption-caused and plan-introduced problems), scope and internal consistency. ' +
        'A plan that claims validation.isValid=true is still re-checked. A plan that breaks a constraint returns isValid=false with the violations; it is not an error. Malformed input (such as a timestamp without a UTC offset) is rejected as a tool error. Read-only.',
      inputSchema: withValidationReporting(planPayloadSchema, (issues) =>
        logger.warn(`Tool: ${VALIDATE_RECOVERY_PLAN_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: validationResultSchema,
      annotations: RECOVERY_TOOL_ANNOTATIONS,
    },
    async (plan) => {
      const started = performance.now();
      logger.info(
        `Tool: ${VALIDATE_RECOVERY_PLAN_TOOL} | Plan: ${plan.planId ?? '(no id)'} | Interval: [${plan.startTime}, ${plan.endTime}) | Changes: ${plan.changes.length}`,
      );
      try {
        const { events, tasks } = await loadPlanningData(deps, plan.startTime, plan.endTime);
        const output = validateRecoveryPlan(plan, { events, tasks });
        logger.info(
          `Tool: ${VALIDATE_RECOVERY_PLAN_TOOL} | Plan: ${plan.planId ?? '(no id)'} | Valid: ${output.isValid} | Violations: ${output.violations.length} | Warnings: ${output.warnings.length} | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );
        return { content: [{ type: 'text' as const, text: formatValidationText(output) }], structuredContent: output };
      } catch (error) {
        return failureResult(logger, VALIDATE_RECOVERY_PLAN_TOOL, error);
      }
    },
  );

  return VALIDATE_RECOVERY_PLAN_TOOL;
}
