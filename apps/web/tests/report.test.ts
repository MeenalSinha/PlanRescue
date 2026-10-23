import { describe, expect, it } from 'vitest';
import {
  generateRecoveryDecisionReport,
  renderRecoveryDecisionReportMarkdown,
  recoveryDecisionReportSchema,
  REPORT_SCHEMA_VERSION,
} from '../src/lib/report';
import type { RecoveryPlan, ScheduleEvent, Task, ActionHistoryItem } from '../src/lib/contract';

describe('Web recovery decision report module', () => {
  const samplePlan: RecoveryPlan = {
    planId: 'plan-minimal-disruption-abc123',
    strategy: 'minimal_disruption',
    summary: 'Shift team sync by 30 minutes to absorb overrun.',
    startTime: '2026-10-23T09:00:00+05:30',
    endTime: '2026-10-23T18:00:00+05:30',
    protectedEventIds: [],
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-001',
      overrunMinutes: 30,
    },
    changes: [
      {
        eventId: 'evt-002',
        title: 'Team Sync',
        originalStartTime: '2026-10-23T10:00:00+05:30',
        originalEndTime: '2026-10-23T10:30:00+05:30',
        proposedStartTime: '2026-10-23T10:30:00+05:30',
        proposedEndTime: '2026-10-23T11:00:00+05:30',
        reason: 'Shifted past overrunning event',
      },
    ],
    unchangedProtectedEvents: [
      {
        eventId: 'evt-003',
        title: 'Medical Appointment',
        startTime: '2026-10-23T14:00:00+05:30',
        endTime: '2026-10-23T15:00:00+05:30',
        priority: 'critical',
        reasons: ['immovable', 'critical_priority'],
      },
    ],
    taskAssessments: [
      {
        taskId: 'task-001',
        title: 'Submit Expense Report',
        deadline: '2026-10-23T17:00:00+05:30',
        priority: 'high',
        estimatedDurationMinutes: 45,
        status: 'feasible',
        baselineStatus: 'feasible',
        origin: 'none',
        cumulativeEffortMinutes: 45,
        availableMinutes: 180,
        slackMinutes: 135,
        note: 'Sufficient slack before deadline.',
      },
    ],
    explanation: {
      changes: ['Team Sync moves by +30 min'],
      unchanged: ['Medical Appointment preserved'],
      rationale: ['Minimal disruption strategy preserves afternoon focus block'],
      taskCapacity: ['Expense report deadline feasible with 135 min slack'],
      limitations: ['Assumes no further meeting overruns'],
    },
    score: {
      total: 25.5,
      rank: 1,
      hardViolations: 0,
      components: {
        changedEvents: 5,
        priorityWeightedDelay: 10,
        focusTime: 5,
        tightTransitions: 0,
        taskRisk: 5.5,
      },
      formula: '5*changed + delay + focus',
    },
    validation: {
      isValid: true,
      checks: [
        {
          name: 'event_existence',
          passed: true,
          severity: 'hard',
          eventId: null,
          taskId: null,
          message: 'All events exist',
        },
      ],
      violations: [],
      warnings: [],
      taskAssessments: [],
      summary: 'All checks passed',
    },
    savedStatus: 'proposed',
    persistentId: 'rec-plan-uuid-999',
  };

  const sampleEvents: ScheduleEvent[] = [
    {
      id: 'evt-001',
      title: 'Sprint Planning',
      startTime: '2026-10-23T09:00:00+05:30',
      endTime: '2026-10-23T10:00:00+05:30',
      priority: 'high',
      movable: false,
      category: 'meeting',
      durationMinutes: 60,
    },
  ];

  const sampleTasks: Task[] = [
    {
      id: 'task-001',
      title: 'Submit Expense Report',
      deadline: '2026-10-23T17:00:00+05:30',
      priority: 'high',
      status: 'pending',
      estimatedDurationMinutes: 45,
    },
  ];

  const sampleHistory: ActionHistoryItem[] = [
    {
      id: 'act-001',
      recoveryPlanId: 'rec-plan-uuid-999',
      actionType: 'plan_saved',
      occurredAt: '2026-10-23T10:05:00+05:30',
      actor: 'local-user',
      summary: 'Saved plan as proposed',
      details: { requestId: 'req-1' },
    },
  ];

  it('generates valid report structure conforming to schema', () => {
    const report = generateRecoveryDecisionReport({
      plan: samplePlan,
      events: sampleEvents,
      tasks: sampleTasks,
      actionHistory: sampleHistory,
      timeZone: 'UTC+05:30',
    });

    const parsed = recoveryDecisionReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    expect(report.metadata.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.metadata.status).toBe('proposed');
    expect(report.metadata.planId).toBe('rec-plan-uuid-999');
    expect(report.recommendedPlan.changesCount).toBe(1);
    expect(report.recommendedPlan.changes[0]?.durationPreserved).toBe(true);
    expect(report.recommendedPlan.changes[0]?.shiftMinutes).toBe(30);
    expect(report.decisionRationale.penaltyScore).toBe(25.5);
    expect(report.auditTrail.length).toBe(1);
    expect(report.auditTrail[0]?.actionType).toBe('plan_saved');
  });

  it('renders Markdown export cleanly with all essential tables and notices', () => {
    const report = generateRecoveryDecisionReport({
      plan: samplePlan,
      events: sampleEvents,
      tasks: sampleTasks,
      actionHistory: sampleHistory,
    });
    const markdown = renderRecoveryDecisionReportMarkdown(report);

    expect(markdown).toContain('# PlanRescue Recovery Decision Report');
    expect(markdown).toContain('`[PROPOSED]`');
    expect(markdown).toContain('Sprint Planning');
    expect(markdown).toContain('Team Sync');
    expect(markdown).toContain('Medical Appointment');
    expect(markdown).toContain('Submit Expense Report');
    expect(markdown).toContain('| Changed Events | 5 |');
    expect(markdown).toContain('Deterministic penalty points; lower is better.');
  });
});
