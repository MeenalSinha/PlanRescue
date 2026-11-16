import { describe, expect, it, vi } from 'vitest';
import { SpatialRecoveryManager } from '../src/recovery/recoveryManager';
import { SpatialAssistantPanel } from '../src/assistant/spatialAssistant';
import { PlanRescueApiClient } from '../src/api/client';
import type { RecoveryPlan, RecoveryPlanSet } from '../src/api/contracts';

describe('Recovery Engine Integration & Intelligence (Phase 6)', () => {
  const mockPlan: RecoveryPlan = {
    planId: 'plan-101',
    persistentId: 'rec-persist-101',
    savedStatus: 'proposed',
    strategy: 'minimal_disruption',
    summary: 'Shift 1 meeting by 30 minutes',
    startTime: '2026-10-22T09:00:00+05:30',
    endTime: '2026-10-22T18:00:00+05:30',
    protectedEventIds: ['evt-exec'],
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-standup',
      overrunMinutes: 30,
    },
    changes: [
      {
        eventId: 'evt-design',
        title: 'Design Review',
        originalStartTime: '2026-10-22T10:00:00+05:30',
        originalEndTime: '2026-10-22T11:00:00+05:30',
        proposedStartTime: '2026-10-22T10:30:00+05:30',
        proposedEndTime: '2026-10-22T11:30:00+05:30',
        reason: 'Shifted forward by 30 minutes to accommodate standup overrun',
      },
    ],
    unchangedProtectedEvents: [
      {
        eventId: 'evt-exec',
        title: 'Executive Review',
        startTime: '2026-10-22T14:00:00+05:30',
        endTime: '2026-10-22T15:30:00+05:30',
        priority: 'critical',
        reasons: ['critical_priority'],
      },
    ],
    taskAssessments: [
      {
        taskId: 'task-slide',
        title: 'Slide Deck',
        deadline: '2026-10-22T17:00:00+05:30',
        priority: 'high',
        estimatedDurationMinutes: 60,
        status: 'feasible',
        baselineStatus: 'feasible',
        origin: 'none',
        cumulativeEffortMinutes: 60,
        availableMinutes: 180,
        slackMinutes: 120,
        note: 'Sufficient capacity remaining before deadline',
      },
    ],
    explanation: {
      changes: ['Design Review moved forward by 30 minutes'],
      unchanged: ['Executive Review kept at original time due to critical priority'],
      rationale: ['Minimal disruption shifts fewest meetings'],
      taskCapacity: ['Task deadlines unaffected'],
      limitations: [],
    },
    score: {
      total: 35.5,
      rank: 1,
      hardViolations: 0,
      components: {
        changedEvents: 1,
        priorityWeightedDelay: 15,
        focusTime: 0,
        tightTransitions: 10,
        taskRisk: 0,
      },
      formula: 'total = changedEvents * 10 + priorityDelay * 1.5 + tightTransitions * 1.0',
    },
    validation: {
      isValid: true,
      checks: [
        {
          name: 'No Overlaps',
          passed: true,
          severity: 'hard',
          eventId: null,
          taskId: null,
          message: 'All meetings have non-overlapping time ranges',
        },
      ],
      violations: [],
      warnings: [],
      taskAssessments: [],
      summary: 'Plan passes all independent validation checks',
    },
  };

  const mockPlanSet: RecoveryPlanSet = {
    interval: {
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T18:00:00+05:30',
    },
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-standup',
      overrunMinutes: 30,
    },
    protectedEventIds: ['evt-exec'],
    outcome: 'plans_found',
    candidates: [mockPlan],
    discardedStrategies: [],
    summary: '1 recovery proposal found',
  };

  it('manages recovery proposals and candidate selection with persistence tracking', async () => {
    const mockClient = {
      proposePlans: vi.fn().mockResolvedValue(mockPlanSet),
      validatePlan: vi.fn().mockResolvedValue(mockPlan.validation),
    } as unknown as PlanRescueApiClient;

    const manager = new SpatialRecoveryManager(mockClient);
    expect(manager.getState()).toBe('idle');

    const result = await manager.generateProposals({
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T18:00:00+05:30',
      disruption: {
        type: 'event_overrun',
        eventId: 'evt-standup',
        overrunMinutes: 30,
      },
    });

    expect(result.candidates.length).toBe(1);
    expect(manager.getState()).toBe('candidates_ready');

    // Verify candidate persistence ID is retained
    const selected = manager.getSelectedCandidate();
    expect(selected?.planId).toBe('plan-101');
    expect(selected?.persistentId).toBe('rec-persist-101');
    expect(selected?.score.total).toBe(35.5);

    // Validate plan
    const valResult = await manager.validateCandidate(selected!);
    expect(valResult.isValid).toBe(true);

    manager.reset();
    expect(manager.getState()).toBe('idle');
  });

  it('explains proposal trade-offs and grounded facts in SpatialAssistantPanel', () => {
    const panel = new SpatialAssistantPanel();
    panel.explainProposal(mockPlan);

    expect(panel.group.children.length).toBeGreaterThan(1);

    // Show infeasible notice
    panel.showInfeasibleExplanation('Conflicts cannot be resolved without shifting immovable events');
    expect(panel.group.children.length).toBeGreaterThan(1);

    panel.dispose();
  });
});
