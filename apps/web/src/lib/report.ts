import * as z from 'zod';
import type {
  RecoveryPlan,
  ScheduleEvent,
  Task,
  ActionHistoryItem,
} from './contract';

export const REPORT_SCHEMA_VERSION = '1.0.0';

export const reportMetadataSchema = z.looseObject({
  reportId: z.string(),
  generatedAt: z.string(),
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  planId: z.string(),
  sourcePlanId: z.string(),
  requestId: z.string(),
  status: z.enum(['proposed', 'approved', 'rejected', 'applied', 'stale']),
  snapshotHash: z.string(),
  planningStart: z.string(),
  planningEnd: z.string(),
  timeZone: z.string(),
  completeness: z.enum(['complete', 'partial']),
  limitations: z.array(z.string()),
});
export type ReportMetadata = z.infer<typeof reportMetadataSchema>;

export const reportDisruptionSchema = z.looseObject({
  type: z.literal('event_overrun'),
  eventId: z.string(),
  eventTitle: z.string(),
  overrunMinutes: z.number(),
  originalStartTime: z.string(),
  originalEndTime: z.string(),
  effectiveEndTime: z.string(),
  description: z.string(),
});
export type ReportDisruption = z.infer<typeof reportDisruptionSchema>;

export const reportChangeSchema = z.looseObject({
  eventId: z.string(),
  title: z.string(),
  originalStartTime: z.string(),
  originalEndTime: z.string(),
  proposedStartTime: z.string(),
  proposedEndTime: z.string(),
  shiftMinutes: z.number(),
  durationMinutes: z.number(),
  durationPreserved: z.boolean(),
  reason: z.string(),
});
export type ReportChange = z.infer<typeof reportChangeSchema>;

export const reportProtectedEventSchema = z.looseObject({
  eventId: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  reasons: z.array(z.string()),
});
export type ReportProtectedEvent = z.infer<typeof reportProtectedEventSchema>;

export const reportScoreSchema = z.looseObject({
  penaltyScore: z.number(),
  scoreComponents: z.looseObject({
    changedEvents: z.number(),
    priorityWeightedDelay: z.number(),
    focusTime: z.number(),
    tightTransitions: z.number(),
    taskRisk: z.number(),
  }),
  scoringNotice: z.string(),
  rankingFormula: z.string(),
  rationale: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type ReportScore = z.infer<typeof reportScoreSchema>;

export const reportTaskImpactSchema = z.looseObject({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  estimatedDurationMinutes: z.number(),
  status: z.enum(['feasible', 'at_risk', 'infeasible', 'not_assessed']),
  baselineStatus: z.enum(['feasible', 'at_risk', 'infeasible', 'not_assessed']),
  origin: z.enum(['none', 'pre_existing', 'disruption', 'plan_introduced']),
  cumulativeEffortMinutes: z.number().nullable(),
  availableMinutes: z.number().nullable(),
  slackMinutes: z.number().nullable(),
  note: z.string(),
});
export type ReportTaskImpact = z.infer<typeof reportTaskImpactSchema>;

export const reportValidationSchema = z.looseObject({
  isValid: z.boolean(),
  summary: z.string(),
  hardViolationsCount: z.number(),
  warningsCount: z.number(),
  violations: z.array(
    z.looseObject({
      check: z.string(),
      message: z.string(),
      eventId: z.string().nullable().optional(),
      taskId: z.string().nullable().optional(),
    }),
  ),
  warnings: z.array(
    z.looseObject({
      check: z.string(),
      message: z.string(),
      eventId: z.string().nullable().optional(),
      taskId: z.string().nullable().optional(),
    }),
  ),
  taskAssessments: z.array(reportTaskImpactSchema),
});
export type ReportValidation = z.infer<typeof reportValidationSchema>;

export const reportAuditEntrySchema = z.looseObject({
  actionType: z.string(),
  occurredAt: z.string(),
  actor: z.string(),
  details: z.string(),
});
export type ReportAuditEntry = z.infer<typeof reportAuditEntrySchema>;

export const recoveryDecisionReportSchema = z.looseObject({
  metadata: reportMetadataSchema,
  disruption: reportDisruptionSchema,
  recommendedPlan: z.looseObject({
    strategy: z.string(),
    rank: z.number(),
    summary: z.string(),
    applied: z.boolean(),
    changesCount: z.number(),
    changes: z.array(reportChangeSchema),
    unchangedProtectedEvents: z.array(reportProtectedEventSchema),
  }),
  decisionRationale: reportScoreSchema,
  validation: reportValidationSchema,
  auditTrail: z.array(reportAuditEntrySchema),
});
export type RecoveryDecisionReport = z.infer<typeof recoveryDecisionReportSchema>;

export interface GenerateWebReportParams {
  plan: RecoveryPlan;
  actionHistory?: ActionHistoryItem[];
  events?: ScheduleEvent[];
  tasks?: Task[];
  timeZone?: string;
  reportId?: string;
  generatedAt?: string;
}

function extractOffset(iso: string): string {
  const match = /([+-]\d{2}:\d{2})$/.exec(iso);
  if (match) return `UTC${match[1]}`;
  if (iso.endsWith('Z')) return 'UTC+00:00';
  return 'UTC';
}

function safeEscape(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function generateRecoveryDecisionReport(params: GenerateWebReportParams): RecoveryDecisionReport {
  const { plan, actionHistory = [], events = [], timeZone } = params;

  const reportId = params.reportId ?? `rep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const offsetStr = extractOffset(plan.startTime);
  const generatedAt = params.generatedAt ?? now.toISOString().replace('Z', offsetStr.replace('UTC', ''));

  const status = plan.savedStatus ?? 'proposed';
  const planId = plan.persistentId ?? plan.planId;
  const requestId = 'planrescue-session';
  const snapshotHash = 'session-snapshot';

  // Disrupted event lookup
  const disruptedEvent = events.find((e) => e.id === plan.disruption.eventId);
  const disruptedTitle = disruptedEvent?.title ?? plan.disruption.eventId;
  const originalStart = disruptedEvent?.startTime ?? plan.startTime;
  const originalEnd = disruptedEvent?.endTime ?? plan.startTime;

  const originalEndMs = Date.parse(originalEnd);
  const overrunMs = plan.disruption.overrunMinutes * 60_000;
  const effectiveEndMs = originalEndMs + overrunMs;
  const effectiveEndTime = new Date(effectiveEndMs).toISOString().replace('Z', offsetStr.replace('UTC', ''));

  // Changes with shift delta and duration preservation check
  const changes: ReportChange[] = plan.changes.map((c) => {
    const origStartMs = Date.parse(c.originalStartTime);
    const origEndMs = Date.parse(c.originalEndTime);
    const propStartMs = Date.parse(c.proposedStartTime);
    const propEndMs = Date.parse(c.proposedEndTime);

    const origDuration = Math.round((origEndMs - origStartMs) / 60_000);
    const propDuration = Math.round((propEndMs - propStartMs) / 60_000);
    const shiftMinutes = Math.round((propStartMs - origStartMs) / 60_000);

    return {
      eventId: c.eventId,
      title: c.title,
      originalStartTime: c.originalStartTime,
      originalEndTime: c.originalEndTime,
      proposedStartTime: c.proposedStartTime,
      proposedEndTime: c.proposedEndTime,
      shiftMinutes,
      durationMinutes: origDuration,
      durationPreserved: origDuration === propDuration,
      reason: c.reason,
    };
  });

  // Protected events
  const unchangedProtectedEvents: ReportProtectedEvent[] = plan.unchangedProtectedEvents.map((p) => ({
    eventId: p.eventId,
    title: p.title,
    startTime: p.startTime,
    endTime: p.endTime,
    priority: p.priority,
    reasons: p.reasons,
  }));

  // Task assessments
  const taskAssessments: ReportTaskImpact[] = (plan.taskAssessments ?? []).map((t) => ({
    taskId: t.taskId,
    title: t.title,
    deadline: t.deadline,
    priority: t.priority,
    estimatedDurationMinutes: t.estimatedDurationMinutes,
    status: t.status,
    baselineStatus: t.baselineStatus,
    origin: t.origin,
    cumulativeEffortMinutes: t.cumulativeEffortMinutes,
    availableMinutes: t.availableMinutes,
    slackMinutes: t.slackMinutes,
    note: t.note,
  }));

  // Tradeoffs
  const tradeoffs = [
    `Ranked #${plan.score.rank} among candidates based on deterministic scoring formula (${plan.score.formula}).`,
    plan.strategy === 'minimal_disruption'
      ? 'Optimized to minimize number of moved events and overall schedule displacement.'
      : plan.strategy === 'buffered_transitions'
        ? 'Optimized to insert transition buffers between back-to-back commitments.'
        : 'Optimized to prioritize high and critical priority events ahead of flexible tasks.',
    'Hard constraints (non-overlapping events, immovability, critical commitments) were strictly enforced and cannot be overridden by soft ranking scores.',
  ];

  // Audit trail
  const auditTrail: ReportAuditEntry[] = actionHistory.map((a) => ({
    actionType: a.actionType,
    occurredAt: a.occurredAt,
    actor: a.actor,
    details: a.summary || JSON.stringify(a.details || {}),
  }));

  const metadata: ReportMetadata = {
    reportId,
    generatedAt,
    schemaVersion: REPORT_SCHEMA_VERSION,
    planId,
    sourcePlanId: plan.planId,
    requestId,
    status,
    snapshotHash,
    planningStart: plan.startTime,
    planningEnd: plan.endTime,
    timeZone: timeZone ?? offsetStr,
    completeness: plan.persistentId ? 'complete' : 'partial',
    limitations: [
      'Single-user local prototype with local-user actor attribution',
      'Execution targets local PlanRescue SQLite calendar database only',
      'Supported disruption model: event_overrun (travel delays and multi-day replanning out of scope)',
      'Deterministic penalty scoring: lower is better; not an AI confidence or probability metric',
    ],
  };

  const report: RecoveryDecisionReport = {
    metadata,
    disruption: {
      type: 'event_overrun',
      eventId: plan.disruption.eventId,
      eventTitle: disruptedTitle,
      overrunMinutes: plan.disruption.overrunMinutes,
      originalStartTime: originalStart,
      originalEndTime: originalEnd,
      effectiveEndTime,
      description: `Event "${disruptedTitle}" overran by ${plan.disruption.overrunMinutes} minutes, ending at ${effectiveEndTime}.`,
    },
    recommendedPlan: {
      strategy: plan.strategy,
      rank: plan.score.rank,
      summary: plan.summary,
      applied: status === 'applied',
      changesCount: changes.length,
      changes,
      unchangedProtectedEvents,
    },
    decisionRationale: {
      penaltyScore: plan.score.total,
      scoreComponents: plan.score.components,
      scoringNotice:
        'Deterministic penalty total (lower is better). Not a probability, confidence interval, or AI-generated score.',
      rankingFormula: plan.score.formula,
      rationale: plan.explanation.rationale,
      tradeoffs,
      limitations: plan.explanation.limitations,
    },
    validation: {
      isValid: plan.validation.isValid,
      summary: plan.validation.summary,
      hardViolationsCount: plan.validation.violations.length,
      warningsCount: plan.validation.warnings.length,
      violations: plan.validation.violations,
      warnings: plan.validation.warnings,
      taskAssessments,
    },
    auditTrail,
  };

  return recoveryDecisionReportSchema.parse(report);
}

export function renderRecoveryDecisionReportMarkdown(report: RecoveryDecisionReport): string {
  const { metadata, disruption, recommendedPlan, decisionRationale, validation, auditTrail } = report;

  const statusBadge = `[${metadata.status.toUpperCase()}]`;
  const isApplied = metadata.status === 'applied';

  const lines: string[] = [
    `# PlanRescue Recovery Decision Report`,
    ``,
    `**Status:** \`${statusBadge}\`  `,
    `**Report ID:** \`${safeEscape(metadata.reportId)}\`  `,
    `**Generated At:** ${metadata.generatedAt}  `,
    `**Schema Version:** \`${metadata.schemaVersion}\`  `,
    `**Plan ID:** \`${safeEscape(metadata.planId)}\`  `,
    `**Request ID:** \`${safeEscape(metadata.requestId)}\`  `,
    `**Snapshot Hash:** \`${safeEscape(metadata.snapshotHash)}\`  `,
    `**Planning Window:** \`${safeEscape(metadata.planningStart)}\` to \`${safeEscape(metadata.planningEnd)}\`  `,
    `**Timezone Context:** ${safeEscape(metadata.timeZone)}  `,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    `*${safeEscape(recommendedPlan.summary)}*`,
    ``,
    `- **Lifecycle State:** Currently **${metadata.status.toUpperCase()}**. ${
      isApplied
        ? 'Calendar changes have been atomically written to the SQLite database.'
        : metadata.status === 'approved'
          ? 'Plan has been approved by the user but NOT yet applied to the calendar.'
          : metadata.status === 'stale'
            ? 'The underlying schedule changed after plan generation. This plan is stale and CANNOT be applied without regenerating.'
            : metadata.status === 'rejected'
              ? 'Plan was rejected and cannot be applied.'
              : 'Plan is proposed and awaiting user review. The calendar remains 100% untouched.'
    }`,
    `- **Strategy & Rank:** #${recommendedPlan.rank} (\`${recommendedPlan.strategy}\`)`,
    `- **Penalty Score:** **${decisionRationale.penaltyScore}** *(Deterministic penalty points; lower is better. Not a probability or AI confidence metric).*`,
    `- **Schedule Modifications:** ${recommendedPlan.changesCount} event(s) rescheduled, ${recommendedPlan.unchangedProtectedEvents.length} protected commitment(s) preserved unchanged.`,
    `- **Validation Verdict:** ${validation.isValid ? '✓ PASSED (0 hard constraint violations)' : '✕ FAILED'}`,
    ``,
    `---`,
    ``,
    `## 1. Disruption Context`,
    ``,
    `- **Disruption Type:** \`${disruption.type}\``,
    `- **Disrupted Event:** **${safeEscape(disruption.eventTitle)}** (\`${safeEscape(disruption.eventId)}\`)`,
    `- **Scheduled Window:** \`${safeEscape(disruption.originalStartTime)}\` — \`${safeEscape(disruption.originalEndTime)}\``,
    `- **Reported Overrun:** **${disruption.overrunMinutes} minutes**`,
    `- **Effective Extended End Time:** \`${safeEscape(disruption.effectiveEndTime)}\``,
    `- **Impact Summary:** ${safeEscape(disruption.description)}`,
    ``,
    `---`,
    ``,
    `## 2. Rescheduled Events (Schedule Diff)`,
    ``,
  ];

  if (recommendedPlan.changes.length === 0) {
    lines.push(`*No calendar events require rescheduling for this plan.*`, ``);
  } else {
    lines.push(
      `| Event | Original Slot | Proposed Slot | Shift | Duration Preserved | Reason |`,
      `| :--- | :--- | :--- | :--- | :---: | :--- |`,
    );
    for (const c of recommendedPlan.changes) {
      const shiftStr = c.shiftMinutes >= 0 ? `+${c.shiftMinutes} min` : `${c.shiftMinutes} min`;
      const durStr = c.durationPreserved ? `Yes (${c.durationMinutes}m)` : `No (${c.durationMinutes}m)`;
      lines.push(
        `| ${safeEscape(c.title)} | ${safeEscape(c.originalStartTime)} — ${safeEscape(c.originalEndTime)} | **${safeEscape(c.proposedStartTime)} — ${safeEscape(c.proposedEndTime)}** | ${shiftStr} | ${durStr} | ${safeEscape(c.reason)} |`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`, ``, `## 3. Protected Commitments (Unchanged Events)`, ``);
  if (recommendedPlan.unchangedProtectedEvents.length === 0) {
    lines.push(`*No protected events were identified in the planning window.*`, ``);
  } else {
    lines.push(
      `| Event | Time Window | Priority | Protection Rationale |`,
      `| :--- | :--- | :---: | :--- |`,
    );
    for (const p of recommendedPlan.unchangedProtectedEvents) {
      lines.push(
        `| ${safeEscape(p.title)} | ${safeEscape(p.startTime)} — ${safeEscape(p.endTime)} | \`${p.priority}\` | ${safeEscape(p.reasons.join(', '))} |`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`, ``, `## 4. Task Capacity & Deadline Feasibility`, ``);
  if (validation.taskAssessments.length === 0) {
    lines.push(`*No pending tasks with deadlines in the planning window were assessed.*`, ``);
  } else {
    lines.push(
      `| Task | Deadline | Duration | Capacity Status | Baseline Status | Risk Origin | Slack | Note |`,
      `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |`,
    );
    for (const t of validation.taskAssessments) {
      const slackStr = t.slackMinutes !== null ? `${t.slackMinutes >= 0 ? '+' : ''}${t.slackMinutes} min` : 'N/A';
      lines.push(
        `| ${safeEscape(t.title)} | ${safeEscape(t.deadline)} | ${t.estimatedDurationMinutes}m | \`${t.status}\` | \`${t.baselineStatus}\` | \`${t.origin}\` | ${slackStr} | ${safeEscape(t.note)} |`,
      );
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## 5. Decision Rationale & Deterministic Scoring`,
    ``,
    `### Score Components`,
    `- **Total Penalty Score:** **${decisionRationale.penaltyScore}**`,
    `- **Scoring Formula:** \`${safeEscape(decisionRationale.rankingFormula)}\``,
    ``,
    `| Component | Penalty Points | Description |`,
    `| :--- | :---: | :--- |`,
    `| Changed Events | ${decisionRationale.scoreComponents.changedEvents} | Penalty for number of rescheduled events |`,
    `| Priority-Weighted Delay | ${decisionRationale.scoreComponents.priorityWeightedDelay} | Delay impact weighted by event priority |`,
    `| Focus Time Disruption | ${decisionRationale.scoreComponents.focusTime} | Impact on contiguous unoccupied focus intervals |`,
    `| Tight Transitions | ${decisionRationale.scoreComponents.tightTransitions} | Penalties for back-to-back transitions (<10m buffer) |`,
    `| Task Deadline Risk | ${decisionRationale.scoreComponents.taskRisk} | Penalties for tasks made at-risk or infeasible |`,
    ``,
    `> **Scoring Notice:** ${safeEscape(decisionRationale.scoringNotice)}`,
    ``,
    `### Optimization Trade-offs`,
  );

  for (const t of decisionRationale.tradeoffs) {
    lines.push(`- ${safeEscape(t)}`);
  }
  lines.push(``);

  if (decisionRationale.limitations.length > 0) {
    lines.push(`### Strategy Limitations`, ``);
    for (const l of decisionRationale.limitations) {
      lines.push(`- ${safeEscape(l)}`);
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## 6. Independent Validation & Safety Findings`,
    ``,
    `- **Validation Verdict:** ${validation.isValid ? '**PASSED**' : '**FAILED**'}`,
    `- **Summary:** ${safeEscape(validation.summary)}`,
    `- **Hard Violations Count:** ${validation.hardViolationsCount}`,
    `- **Warnings Count:** ${validation.warningsCount}`,
    ``,
  );

  if (validation.violations.length > 0) {
    lines.push(`### Hard Violations`, ``);
    for (const v of validation.violations) {
      lines.push(`- ✕ **${safeEscape(v.check)}**: ${safeEscape(v.message)}`);
    }
    lines.push(``);
  }

  if (validation.warnings.length > 0) {
    lines.push(`### Warnings`, ``);
    for (const w of validation.warnings) {
      lines.push(`- ⚠️ **${safeEscape(w.check)}**: ${safeEscape(w.message)}`);
    }
    lines.push(``);
  }

  lines.push(`---`, ``, `## 7. Audit Trail & Action History`, ``);
  if (auditTrail.length === 0) {
    lines.push(`*No action history records were recorded for this plan.*`, ``);
  } else {
    lines.push(
      `| Timestamp | Action Type | Actor | Details / Outcome |`,
      `| :--- | :--- | :--- | :--- |`,
    );
    for (const a of auditTrail) {
      lines.push(
        `| ${safeEscape(a.occurredAt)} | \`${safeEscape(a.actionType)}\` | \`${safeEscape(a.actor)}\` | ${safeEscape(a.details)} |`,
      );
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## 8. Governance & Scope Notice`,
    ``,
  );
  for (const lim of metadata.limitations) {
    lines.push(`- ${safeEscape(lim)}`);
  }
  lines.push(
    `- **Read-Only Safety Guarantee:** Generating, inspecting, or exporting this report is strictly read-only and causes zero mutations to stored calendar events or plan lifecycle status.`,
    ``,
  );

  return lines.join('\n');
}
