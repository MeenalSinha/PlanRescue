/**
 * Grounded natural-language explanation generation for PlanRescue.
 *
 * Explanations are strictly grounded in the actual deterministic output from
 * analyze_conflicts, propose_recovery_plan, and validate_recovery_plan.
 */
import type { ConflictAnalysis, RecoveryPlan, RecoveryPlanSet, ValidationResult } from '../contract';
import type { AgentScenarioContext, ExtractedIntent } from './types';

export function formatEventTimeRange(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso);
    const e = new Date(endIso);
    const timeFmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${timeFmt(s)}–${timeFmt(e)}`;
  } catch {
    return `${startIso}–${endIso}`;
  }
}

export function generateClarificationMessage(intent: ExtractedIntent): string {
  if (intent.clarificationQuestion) {
    return intent.clarificationQuestion;
  }
  if (intent.missingInformation === 'duration') {
    return 'How many minutes is the meeting running late?';
  }
  if (intent.missingInformation === 'event') {
    return 'Which meeting is running late?';
  }
  return 'Could you please specify which meeting is delayed and by how many minutes?';
}

export function generateUnsupportedMessage(intent: ExtractedIntent): string {
  if (intent.unsupportedReason) {
    return `PlanRescue currently supports schedule recovery for meeting overruns and delays. ${intent.unsupportedReason}`;
  }
  return 'PlanRescue currently supports schedule recovery for meeting overruns. Direct calendar editing, meeting cancellations, and arbitrary event creation are not supported in this version.';
}

export function generateInfeasibleMessage(
  scenario: AgentScenarioContext,
  analysis: ConflictAnalysis,
  planSet: RecoveryPlanSet,
): string {
  const parts: string[] = [];
  parts.push(
    `I analyzed the ${scenario.overrunMinutes}-minute overrun on "${scenario.targetEventTitle}".`,
  );

  if (analysis.newConflicts.length > 0) {
    parts.push(
      `This disruption introduces ${analysis.newConflicts.length} conflict${analysis.newConflicts.length > 1 ? 's' : ''}: ${analysis.newConflicts.map((c) => c.description).join('; ')}.`,
    );
  }

  if (planSet.infeasibility?.summary) {
    parts.push(`No feasible recovery plan was found: ${planSet.infeasibility.summary}.`);
  } else if (planSet.infeasibility?.reasons && planSet.infeasibility.reasons.length > 0) {
    parts.push(
      `No feasible recovery plan was found because: ${planSet.infeasibility.reasons.map((r) => r.message).join('; ')}.`,
    );
  } else {
    parts.push('No valid recovery plan could be found that satisfies all constraints and protected commitments.');
  }

  if (scenario.protectedEventIds.length > 0) {
    parts.push(
      'Tip: Try unprotecting some optional events or extending the planning window to allow more rescheduling flexibility.',
    );
  }

  parts.push('Note: Your calendar has not been modified.');
  return parts.join(' ');
}

export function generateGroundedPlanExplanation(
  scenario: AgentScenarioContext,
  analysis: ConflictAnalysis,
  plan: RecoveryPlan,
  validation: ValidationResult,
): string {
  const parts: string[] = [];

  // 1. What was understood
  parts.push(`Understood: "${scenario.targetEventTitle}" is running ${scenario.overrunMinutes} minutes late.`);

  // 2. Conflict identified
  if (analysis.newConflicts.length > 0) {
    const conflictDesc = analysis.newConflicts.map((c) => c.description).join('; ');
    parts.push(`This created a conflict: ${conflictDesc}.`);
  }

  // 3. Protected appointments
  if (plan.unchangedProtectedEvents.length > 0) {
    const protectedTitles = plan.unchangedProtectedEvents.map((p) => `"${p.title}"`).join(', ');
    parts.push(`Protected ${protectedTitles} without any changes.`);
  }

  // 4. Proposed changes
  if (plan.changes.length > 0) {
    const changesSummary = plan.changes
      .map((c) => `moved "${c.title}" to ${formatEventTimeRange(c.proposedStartTime, c.proposedEndTime)}`)
      .join(', ');
    parts.push(`Recommended plan (${plan.strategy.replace('_', ' ')}): ${changesSummary}.`);
  } else {
    parts.push('No event shifts are required.');
  }

  // 5. Validation status
  if (validation.isValid) {
    parts.push('The proposed recovery plan was independently validated and passed all safety checks with 0 violations.');
  } else {
    parts.push(`Warning: Validation reported ${validation.violations.length} violation(s): ${validation.summary}.`);
  }

  // 6. Explicit safety notice
  parts.push('Your calendar remains unchanged.');

  return parts.join(' ');
}
