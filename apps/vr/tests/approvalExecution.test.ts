import { describe, expect, it, vi } from 'vitest';
import { SpatialApprovalWorkflow } from '../src/execution/approvalWorkflow';
import { SpatialActionHistoryPanel } from '../src/history/spatialActionHistory';
import { PlanRescueApiClient } from '../src/api/client';
import type { ActionHistoryItem, RecoveryPlan } from '../src/api/contracts';

describe('Approval, Safe Execution & Audit Trail (Phase 8)', () => {
  const mockPlan: RecoveryPlan = {
    planId: 'plan-xyz',
    persistentId: 'rec-persistent-xyz',
    savedStatus: 'proposed',
    strategy: 'minimal_disruption',
    summary: 'Shift 1 event',
    startTime: '2026-10-22T09:00:00+05:30',
    endTime: '2026-10-22T18:00:00+05:30',
    protectedEventIds: [],
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-1',
      overrunMinutes: 30,
    },
    changes: [
      {
        eventId: 'evt-2',
        title: 'Design Review',
        originalStartTime: '2026-10-22T10:00:00+05:30',
        originalEndTime: '2026-10-22T11:00:00+05:30',
        proposedStartTime: '2026-10-22T10:30:00+05:30',
        proposedEndTime: '2026-10-22T11:30:00+05:30',
        reason: 'Shifted forward by 30 min',
      },
    ],
    unchangedProtectedEvents: [],
    taskAssessments: [],
    explanation: {
      changes: ['Design Review shifted'],
      unchanged: [],
      rationale: ['Minimal disruption'],
      taskCapacity: [],
      limitations: [],
    },
    score: {
      total: 20,
      rank: 1,
      hardViolations: 0,
      components: {
        changedEvents: 1,
        priorityWeightedDelay: 10,
        focusTime: 0,
        tightTransitions: 0,
        taskRisk: 0,
      },
      formula: 'score = total',
    },
    validation: {
      isValid: true,
      checks: [],
      violations: [],
      warnings: [],
      taskAssessments: [],
      summary: 'Valid',
    },
  };

  const mockHistory: ActionHistoryItem[] = [
    {
      id: 'act-1',
      recoveryPlanId: 'rec-persistent-xyz',
      actionType: 'plan_approved',
      occurredAt: '2026-10-22T14:30:00+05:30',
      actor: 'spatial_user',
      summary: 'Plan rec-persistent-xyz approved',
      details: {},
    },
    {
      id: 'act-2',
      recoveryPlanId: 'rec-persistent-xyz',
      actionType: 'plan_applied',
      occurredAt: '2026-10-22T14:31:00+05:30',
      actor: 'spatial_user',
      summary: 'Plan applied: 1 event updated',
      details: {},
    },
  ];

  it('enforces two-step workflow: explicit approval then separate execution confirmation', async () => {
    const mockClient = {
      approvePlan: vi.fn().mockResolvedValue({
        planId: 'rec-persistent-xyz',
        status: 'approved',
        approvedAt: '2026-10-22T14:30:00+05:30',
        strategy: 'minimal_disruption',
        summary: 'Approved',
        message: 'Plan approved',
      }),
      applyPlan: vi.fn().mockResolvedValue({
        planId: 'rec-persistent-xyz',
        status: 'applied',
        appliedAt: '2026-10-22T14:31:00+05:30',
        strategy: 'minimal_disruption',
        changesCount: 1,
        changes: [
          {
            eventId: 'evt-2',
            title: 'Design Review',
            previousStartTime: '2026-10-22T10:00:00+05:30',
            previousEndTime: '2026-10-22T11:00:00+05:30',
            newStartTime: '2026-10-22T10:30:00+05:30',
            newEndTime: '2026-10-22T11:30:00+05:30',
          },
        ],
        message: 'Applied',
      }),
    } as unknown as PlanRescueApiClient;

    const workflow = new SpatialApprovalWorkflow(mockClient);
    workflow.loadPlanForReview(mockPlan);

    // Initial state is 'review'
    expect(workflow.getStep()).toBe('review');

    // Step 1: Explicit Approval
    const approveRes = await workflow.executeApproval('test_user');
    expect(approveRes.status).toBe('approved');
    expect(workflow.getStep()).toBe('approved');
    expect(mockClient.approvePlan).toHaveBeenCalledWith('rec-persistent-xyz', 'test_user');

    // Step 2: Separate Confirmation & Execution
    const applyRes = await workflow.executeApplication('test_user');
    expect(applyRes.status).toBe('applied');
    expect(workflow.getStep()).toBe('applied');
    expect(mockClient.applyPlan).toHaveBeenCalledWith('rec-persistent-xyz', { actor: 'test_user' });

    workflow.dispose();
  });

  it('handles stale plan rejection and notifies user to recalculate fresh scenario', async () => {
    const mockClient = {
      approvePlan: vi.fn().mockResolvedValue({
        planId: 'rec-persistent-xyz',
        status: 'approved',
        approvedAt: '2026-10-22T14:30:00+05:30',
        strategy: 'minimal_disruption',
        summary: 'Approved',
        message: 'Plan approved',
      }),
      applyPlan: vi.fn().mockRejectedValue(new Error('Plan is stale: schedule snapshot changed')),
    } as unknown as PlanRescueApiClient;

    const workflow = new SpatialApprovalWorkflow(mockClient);
    workflow.loadPlanForReview(mockPlan);

    await workflow.executeApproval('test_user');
    await expect(workflow.executeApplication('test_user')).rejects.toThrow();

    expect(workflow.getStep()).toBe('stale_rejected');
    workflow.dispose();
  });

  it('renders persistent audit history in SpatialActionHistoryPanel', () => {
    const panel = new SpatialActionHistoryPanel();
    panel.setHistoryEntries(mockHistory);

    expect(panel.group.children.length).toBeGreaterThan(1);

    panel.clearHistory();
    panel.setHistoryEntries([]);
    expect(panel.group.getObjectByName('empty_history_notice')).toBeDefined();

    panel.dispose();
  });
});
