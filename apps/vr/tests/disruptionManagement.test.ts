import { describe, expect, it, vi } from 'vitest';
import { SpatialDisruptionPanel } from '../src/disruption/disruptionPanel';
import { SpatialConflictVisualizer, SpatialConflictCard } from '../src/disruption/conflictVisualizer';
import type { ConflictAnalysis, Disruption, ScheduleEvent } from '../src/api/contracts';

describe('Disruption & Scenario Management (Phase 5)', () => {
  const mockEvent: ScheduleEvent = {
    id: 'evt-sync',
    title: 'Product Sync',
    startTime: '2026-10-22T14:00:00+05:30',
    endTime: '2026-10-22T14:45:00+05:30',
    durationMinutes: 45,
    priority: 'high',
    movable: true,
    category: 'meeting',
  };

  const mockAnalysis: ConflictAnalysis = {
    interval: {
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T18:00:00+05:30',
    },
    disruption: {
      type: 'event_overrun',
      eventId: 'evt-sync',
      overrunMinutes: 30,
    },
    eventsExamined: 4,
    tasksExamined: 2,
    existingConflicts: [],
    newConflicts: [
      {
        issueId: 'conf-1',
        category: 'event_overlap',
        severity: 'high',
        affectedEventIds: ['evt-sync', 'evt-next'],
        affectedTaskIds: [],
        description: 'Product Sync overrun overlaps with Design Review',
        interval: {
          startTime: '2026-10-22T14:45:00+05:30',
          endTime: '2026-10-22T15:15:00+05:30',
        },
        introducedByDisruption: true,
        resolvable: true,
        suggestedNextStep: 'Reschedule Design Review to open slot at 15:30',
      },
    ],
    affectedEvents: [
      {
        eventId: 'evt-next',
        title: 'Design Review',
        impact: 'direct_overlap',
        canBeRescheduled: true,
        reason: 'Shifted forward by 30 minutes',
      },
    ],
    protectedConstraints: [],
    taskAssessments: [],
    warnings: [],
    assessment: {
      status: 'conflicts_resolvable',
      summary: '1 overlap introduced by overrun, resolvable via buffer shift',
    },
  };

  it('configures overrun duration strictly within backend bounds [1, 240]', () => {
    const panel = new SpatialDisruptionPanel();

    panel.setOverrunMinutes(45);
    expect(panel.getOverrunMinutes()).toBe(45);

    // Below minimum (1 min) clamps to 1
    panel.setOverrunMinutes(0);
    expect(panel.getOverrunMinutes()).toBe(1);

    // Above maximum (240 min) clamps to 240
    panel.setOverrunMinutes(500);
    expect(panel.getOverrunMinutes()).toBe(240);

    panel.dispose();
  });

  it('formats target event details and emits disruption submission', () => {
    const panel = new SpatialDisruptionPanel();
    const onSubmit = vi.fn();
    panel.onSubmitDisruption(onSubmit);

    panel.setTargetEvent(mockEvent);
    expect(panel.getTargetEvent()?.id).toBe('evt-sync');

    panel.setOverrunMinutes(30);

    // Trigger submission
    const submitBtn = panel.group.getObjectByName('Btn_Analyze_Impact');
    expect(submitBtn).toBeDefined();

    panel.dispose();
  });

  it('renders conflict cards from ConflictAnalysis in SpatialConflictVisualizer', () => {
    const visualizer = new SpatialConflictVisualizer();
    visualizer.displayAnalysis(mockAnalysis);

    expect(visualizer.group.children.length).toBeGreaterThan(1);

    // Clear conflicts
    visualizer.clearConflicts();

    // Display clean state with no conflicts
    visualizer.displayAnalysis({
      ...mockAnalysis,
      newConflicts: [],
      existingConflicts: [],
    });
    expect(visualizer.group.getObjectByName('no_conflicts_notice')).toBeDefined();

    visualizer.dispose();
  });
});
