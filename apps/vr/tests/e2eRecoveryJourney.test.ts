import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PlanRescueApiClient } from '../src/api/client';
import { HandInteractionManager } from '../src/interaction/handInteractionManager';
import { SpatialStudioEnvironment } from '../src/ui/components';
import { SpatialTimeline } from '../src/calendar/spatialTimeline';
import { SpatialTaskPanel } from '../src/calendar/taskPanel';
import { SpatialDisruptionPanel } from '../src/disruption/disruptionPanel';
import { SpatialConflictVisualizer } from '../src/disruption/conflictVisualizer';
import { SpatialRecoveryManager } from '../src/recovery/recoveryManager';
import { SpatialComparisonWorkspace } from '../src/comparison/comparisonWorkspace';
import { SpatialValidationExplorer } from '../src/comparison/validationExplorer';
import { SpatialApprovalWorkflow } from '../src/execution/approvalWorkflow';
import { SpatialActionHistoryPanel } from '../src/history/spatialActionHistory';
import type {
  ConflictAnalysis,
  DashboardData,
  RecoveryPlan,
  RecoveryPlanSet,
} from '../src/api/contracts';

describe('PlanRescue Spatial - Full End-to-End Recovery Journey (Milestones 1-16)', () => {
  const mockDashboard: DashboardData = {
    date: '2026-10-22',
    calendarTimeZone: 'Asia/Kolkata',
    taskTimeZone: 'Asia/Kolkata',
    utcOffset: '+05:30',
    window: {
      startTime: '2026-10-22T00:00:00+05:30',
      endTime: '2026-10-23T00:00:00+05:30',
    },
    taskWindow: {
      startTime: '2026-10-22T00:00:00+05:30',
      endTime: '2026-10-26T00:00:00+05:30',
    },
    events: [
      {
        id: 'evt-standup',
        title: 'Team Standup',
        startTime: '2026-10-22T09:00:00+05:30',
        endTime: '2026-10-22T09:30:00+05:30',
        durationMinutes: 30,
        priority: 'high',
        movable: true,
        category: 'meeting',
      },
      {
        id: 'evt-architecture',
        title: 'Architecture Review',
        startTime: '2026-10-22T10:00:00+05:30',
        endTime: '2026-10-22T11:00:00+05:30',
        durationMinutes: 60,
        priority: 'critical',
        movable: false,
        category: 'meeting',
      },
    ],
    tasks: [
      {
        id: 'task-deck',
        title: 'Complete Hackathon Deck',
        estimatedDurationMinutes: 60,
        deadline: '2026-10-22T17:00:00+05:30',
        priority: 'high',
        status: 'pending',
      },
    ],
    baseline: null,
    baselineError: null,
  };

  const mockConflictAnalysis: ConflictAnalysis = {
    interval: {
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T18:00:00+05:30',
    },
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-standup',
      overrunMinutes: 45,
    },
    eventsExamined: 2,
    tasksExamined: 1,
    existingConflicts: [],
    newConflicts: [
      {
        issueId: 'conf-overlap-1',
        category: 'event_overlap',
        severity: 'high',
        affectedEventIds: ['evt-standup', 'evt-architecture'],
        affectedTaskIds: [],
        description: 'Team Standup overrun extends into Architecture Review',
        interval: {
          startTime: '2026-10-22T10:00:00+05:30',
          endTime: '2026-10-22T10:15:00+05:30',
        },
        introducedByDisruption: true,
        resolvable: true,
        suggestedNextStep: 'Shift Architecture Review or buffer downstream focus blocks',
      },
    ],
    affectedEvents: [
      {
        eventId: 'evt-architecture',
        title: 'Architecture Review',
        impact: 'direct_overlap',
        canBeRescheduled: false,
        reason: 'Protected critical event',
      },
    ],
    protectedConstraints: [
      {
        eventId: 'evt-architecture',
        title: 'Architecture Review',
        startTime: '2026-10-22T10:00:00+05:30',
        endTime: '2026-10-22T11:00:00+05:30',
        priority: 'critical',
        reasons: ['critical_priority'],
      },
    ],
    taskAssessments: [],
    warnings: [],
    assessment: {
      status: 'conflicts_resolvable',
      summary: '1 overlap detected, candidate proposals generated',
    },
  };

  const mockCandidatePlan: RecoveryPlan = {
    planId: 'plan-candidate-1',
    persistentId: 'rec-persistent-e2e',
    savedStatus: 'proposed',
    strategy: 'minimal_disruption',
    summary: 'Shift downstream focus block by 45 minutes',
    startTime: '2026-10-22T09:00:00+05:30',
    endTime: '2026-10-22T18:00:00+05:30',
    protectedEventIds: ['evt-architecture'],
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-standup',
      overrunMinutes: 45,
    },
    changes: [
      {
        eventId: 'evt-architecture',
        title: 'Architecture Review',
        originalStartTime: '2026-10-22T10:00:00+05:30',
        originalEndTime: '2026-10-22T11:00:00+05:30',
        proposedStartTime: '2026-10-22T10:15:00+05:30',
        proposedEndTime: '2026-10-22T11:15:00+05:30',
        reason: 'Accommodate standup overrun',
      },
    ],
    unchangedProtectedEvents: [],
    taskAssessments: [],
    explanation: {
      changes: ['Architecture Review shifted by 15m'],
      unchanged: [],
      rationale: ['Minimal disruption'],
      taskCapacity: ['Task capacity preserved'],
      limitations: [],
    },
    score: {
      total: 18.5,
      rank: 1,
      hardViolations: 0,
      components: {
        changedEvents: 1,
        priorityWeightedDelay: 8,
        focusTime: 0,
        tightTransitions: 5,
        taskRisk: 0,
      },
      formula: 'total = score',
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
          message: 'Zero overlaps remain',
        },
      ],
      violations: [],
      warnings: [],
      taskAssessments: [],
      summary: 'Validated',
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
      overrunMinutes: 45,
    },
    protectedEventIds: ['evt-architecture'],
    outcome: 'plans_found',
    candidates: [mockCandidatePlan],
    discardedStrategies: [],
    summary: '1 candidate generated',
  };

  it('completes the full 16-step user journey from entry to execution & audit inspection', async () => {
    // Setup Mock API client
    const mockClient = {
      getDashboard: vi.fn().mockResolvedValue(mockDashboard),
      analyzeDisruption: vi.fn().mockResolvedValue(mockConflictAnalysis),
      proposePlans: vi.fn().mockResolvedValue(mockPlanSet),
      validatePlan: vi.fn().mockResolvedValue(mockCandidatePlan.validation),
      approvePlan: vi.fn().mockResolvedValue({
        planId: 'rec-persistent-e2e',
        status: 'approved',
        approvedAt: '2026-10-22T15:00:00+05:30',
        strategy: 'minimal_disruption',
        summary: 'Approved',
        message: 'Plan approved',
      }),
      applyPlan: vi.fn().mockResolvedValue({
        planId: 'rec-persistent-e2e',
        status: 'applied',
        appliedAt: '2026-10-22T15:01:00+05:30',
        strategy: 'minimal_disruption',
        changesCount: 1,
        changes: [
          {
            eventId: 'evt-architecture',
            title: 'Architecture Review',
            previousStartTime: '2026-10-22T10:00:00+05:30',
            previousEndTime: '2026-10-22T11:00:00+05:30',
            newStartTime: '2026-10-22T10:15:00+05:30',
            newEndTime: '2026-10-22T11:15:00+05:30',
          },
        ],
        message: 'Plan executed into SQLite',
      }),
      getActionHistory: vi.fn().mockResolvedValue({
        count: 2,
        entries: [
          {
            id: 'act-e2e-1',
            recoveryPlanId: 'rec-persistent-e2e',
            actionType: 'plan_approved',
            occurredAt: '2026-10-22T15:00:00+05:30',
            actor: 'spatial_user',
            summary: 'Plan approved',
            details: {},
          },
          {
            id: 'act-e2e-2',
            recoveryPlanId: 'rec-persistent-e2e',
            actionType: 'plan_applied',
            occurredAt: '2026-10-22T15:01:00+05:30',
            actor: 'spatial_user',
            summary: 'Plan applied: 1 event updated',
            details: {},
          },
        ],
      }),
    } as unknown as PlanRescueApiClient;

    // 1. Application Startup & Studio Scene Initialization
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.25, 0); // Seated position
    const studio = new SpatialStudioEnvironment(scene);
    const interactionManager = new HandInteractionManager(scene, camera);

    // 2. Load Calendar and Task data from Backend API
    const dashboardData = await mockClient.getDashboard('2026-10-22');
    expect(dashboardData.events.length).toBe(2);

    // 3. Render Spatial Timeline and Task Panel
    const timeline = new SpatialTimeline(interactionManager);
    timeline.setEvents(dashboardData.events);
    const taskPanel = new SpatialTaskPanel();
    taskPanel.setTasks(dashboardData.tasks);

    // 4. Select Meeting ("Team Standup")
    const standupEvent = dashboardData.events[0]!;
    const disruptionPanel = new SpatialDisruptionPanel();
    disruptionPanel.setTargetEvent(standupEvent);
    expect(disruptionPanel.getTargetEvent()?.title).toBe('Team Standup');

    // 5. Configure Overrun (+45m)
    disruptionPanel.setOverrunMinutes(45);
    expect(disruptionPanel.getOverrunMinutes()).toBe(45);

    // 6. Execute Conflict Analysis via Backend API
    const conflictAnalysis = await mockClient.analyzeDisruption({
      startTime: dashboardData.window.startTime,
      endTime: dashboardData.window.endTime,
      disruption: {
        type: 'event_overrun',
        eventId: standupEvent.id,
        overrunMinutes: 45,
      },
    });
    expect(conflictAnalysis.newConflicts.length).toBe(1);

    // 7. Visualize Conflicts on Conflict Visualizer
    const conflictVisualizer = new SpatialConflictVisualizer();
    conflictVisualizer.displayAnalysis(conflictAnalysis);

    // 8. Generate Recovery Proposals via Deterministic Recovery Engine
    const recoveryManager = new SpatialRecoveryManager(mockClient);
    const planSet = await recoveryManager.generateProposals({
      startTime: dashboardData.window.startTime,
      endTime: dashboardData.window.endTime,
      disruption: {
        type: 'event_overrun',
        eventId: standupEvent.id,
        overrunMinutes: 45,
      },
    });
    expect(planSet.candidates.length).toBe(1);
    const selectedCandidate = recoveryManager.getSelectedCandidate()!;
    expect(selectedCandidate.persistentId).toBe('rec-persistent-e2e');

    // 9. Compare Proposed Schedules in Comparison Workspace
    const comparisonWorkspace = new SpatialComparisonWorkspace(interactionManager);
    comparisonWorkspace.setCandidates(planSet.candidates, dashboardData.events);

    // 10. Execute Independent Plan Validation
    const validationResult = await recoveryManager.validateCandidate(selectedCandidate);
    expect(validationResult.isValid).toBe(true);

    const validationExplorer = new SpatialValidationExplorer();
    validationExplorer.displayValidation(validationResult);

    // 11. Step 1: Explicit Plan Approval (using durable persistentId)
    const workflow = new SpatialApprovalWorkflow(mockClient);
    workflow.loadPlanForReview(selectedCandidate);
    expect(workflow.getStep()).toBe('review');

    const approveOutput = await workflow.executeApproval('spatial_user');
    expect(approveOutput.status).toBe('approved');
    expect(workflow.getStep()).toBe('approved');

    // 12. Step 2: Separate Execution Confirmation (Safe Execution)
    const applyOutput = await workflow.executeApplication('spatial_user');
    expect(applyOutput.status).toBe('applied');
    expect(applyOutput.changesCount).toBe(1);
    expect(workflow.getStep()).toBe('applied');

    // 13. Refresh Schedule from Fresh Backend State
    const refreshedDashboard = await mockClient.getDashboard('2026-10-22');
    timeline.setEvents(refreshedDashboard.events);

    // 14. Inspect Action History Audit Trail
    const historyData = await mockClient.getActionHistory();
    expect(historyData.entries.length).toBe(2);

    const historyPanel = new SpatialActionHistoryPanel();
    historyPanel.setHistoryEntries(historyData.entries);

    // 15. Clean Disposal
    timeline.dispose();
    taskPanel.dispose();
    disruptionPanel.dispose();
    conflictVisualizer.dispose();
    comparisonWorkspace.dispose();
    validationExplorer.dispose();
    workflow.dispose();
    historyPanel.dispose();
    interactionManager.dispose();
    studio.dispose();
  });
});
