import { describe, expect, it, vi } from 'vitest';
import { SpatialWorld } from '../src/core/world';
import type { PlanRescueApiClient } from '../src/api/client';
import type { DashboardData, GetActionHistoryOutput } from '../src/api/contracts';
import { SpatialAppController } from '../src/app/spatialAppController';

describe('SpatialAppController (Runtime Application Orchestration)', () => {
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
        id: 'evt-test-1',
        title: 'Team Sync',
        startTime: '2026-10-22T10:00:00+05:30',
        endTime: '2026-10-22T10:30:00+05:30',
        durationMinutes: 30,
        priority: 'high',
        movable: true,
        category: 'meeting',
      },
    ],
    tasks: [
      {
        id: 'task-test-1',
        title: 'Draft Report',
        estimatedDurationMinutes: 45,
        deadline: '2026-10-22T17:00:00+05:30',
        priority: 'medium',
        status: 'pending',
      },
    ],
    baseline: null,
    baselineError: null,
  };

  const mockHistory: GetActionHistoryOutput = {
    count: 1,
    entries: [
      {
        id: 'act-1',
        recoveryPlanId: 'rec-1',
        actionType: 'plan_applied',
        occurredAt: '2026-10-22T12:00:00+05:30',
        actor: 'local-user',
        summary: 'Plan applied: 1 event updated',
        details: {},
      },
    ],
  };

  const mockApi = {
    getDashboard: vi.fn().mockResolvedValue(mockDashboard),
    getActionHistory: vi.fn().mockResolvedValue(mockHistory),
    analyzeDisruption: vi.fn(),
    proposePlans: vi.fn(),
    validatePlan: vi.fn(),
    approvePlan: vi.fn(),
    applyPlan: vi.fn(),
  } as unknown as PlanRescueApiClient;

  it('initializes and mounts all Phase 2-8 spatial modules in the 3-zone layout', () => {
    const world = new SpatialWorld();
    const controller = new SpatialAppController({
      world,
      api: mockApi,
      config: {
        appEnv: 'test',
        apiBaseUrl: '',
        logLevel: 'error',
        requestTimeoutMs: 5000,
        xr: { sessionMode: 'immersive-vr', enableHandTracking: true, enableEmulation: true },
      },
    });

    // Check all panels are created and added to scene
    expect(controller.timeline).toBeDefined();
    expect(controller.taskPanel).toBeDefined();
    expect(controller.disruptionPanel).toBeDefined();
    expect(controller.conflictVisualizer).toBeDefined();
    expect(controller.assistantPanel).toBeDefined();
    expect(controller.comparisonWorkspace).toBeDefined();
    expect(controller.validationExplorer).toBeDefined();
    expect(controller.approvalWorkflow).toBeDefined();
    expect(controller.actionHistoryPanel).toBeDefined();

    // Verify scene contains the panels
    expect(world.scene.children).toContain(controller.timeline.group);
    expect(world.scene.children).toContain(controller.taskPanel.group);
    expect(world.scene.children).toContain(controller.disruptionPanel.group);
    expect(world.scene.children).toContain(controller.assistantPanel.group);

    controller.dispose();
    world.dispose();
  });

  it('loads real dashboard and audit history data into spatial panels', async () => {
    const world = new SpatialWorld();
    const controller = new SpatialAppController({
      world,
      api: mockApi,
      config: {
        appEnv: 'test',
        apiBaseUrl: '',
        logLevel: 'error',
        requestTimeoutMs: 5000,
        xr: { sessionMode: 'immersive-vr', enableHandTracking: true, enableEmulation: true },
      },
    });

    await controller.loadInitialData();
    expect(mockApi.getDashboard).toHaveBeenCalled();
    expect(mockApi.getActionHistory).toHaveBeenCalled();

    // Verify timeline has event blocks
    expect(controller.timeline.group.children.length).toBeGreaterThan(1);
    // Verify task panel has tasks
    expect(controller.taskPanel.group.children.length).toBeGreaterThan(1);

    controller.dispose();
    world.dispose();
  });
});
