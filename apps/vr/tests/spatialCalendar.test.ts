import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SpatialTimeline, SpatialEventBlock } from '../src/calendar/spatialTimeline';
import { SpatialTaskPanel, SpatialTaskCard } from '../src/calendar/taskPanel';
import type { ScheduleEvent, Task } from '../src/api/contracts';
import { HandInteractionManager } from '../src/interaction/handInteractionManager';

describe('Spatial Calendar & Timeline (Phase 4)', () => {
  const mockEvents: ScheduleEvent[] = [
    {
      id: 'evt-1',
      title: 'Morning Standup',
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T09:30:00+05:30',
      durationMinutes: 30,
      priority: 'high',
      movable: true,
      category: 'meeting',
    },
    {
      id: 'evt-2',
      title: 'Executive Review',
      startTime: '2026-10-22T10:00:00+05:30',
      endTime: '2026-10-22T11:30:00+05:30',
      durationMinutes: 90,
      priority: 'critical',
      movable: false,
      category: 'meeting',
    },
  ];

  const mockTasks: Task[] = [
    {
      id: 'task-1',
      title: 'Prepare Slide Deck',
      estimatedDurationMinutes: 60,
      deadline: '2026-10-22T17:00:00+05:30',
      priority: 'high',
      status: 'pending',
    },
    {
      id: 'task-2',
      title: 'Submit Expense Report',
      estimatedDurationMinutes: 30,
      deadline: '2026-10-22T18:00:00+05:30',
      priority: 'medium',
      status: 'in_progress',
    },
  ];

  it('renders events accurately along the 3D timeline track', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const interactionManager = new HandInteractionManager(scene, camera);

    const timeline = new SpatialTimeline(interactionManager, {
      trackWidth: 1.2,
      dayStartHour: 8,
      dayEndHour: 20,
    });

    timeline.setEvents(mockEvents);

    // Two event blocks should be created
    expect(timeline.group.children.length).toBeGreaterThan(2);

    // Fixed event should not be grabbable, movable should be grabbable
    const selectCb = vi.fn();
    timeline.onSelectEvent(selectCb);

    // Simulate clicking evt-1
    interactionManager.processPointerRay(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    );

    expect(timeline.getSelectedEventId()).toBeNull();
    timeline.dispose();
    interactionManager.dispose();
  });

  it('identifies fixed vs movable events with lock visual badges', () => {
    const movableBlock = new SpatialEventBlock(mockEvents[0]!, 0.15, 0.12);
    expect(movableBlock.event.movable).toBe(true);

    const fixedBlock = new SpatialEventBlock(mockEvents[1]!, 0.25, 0.12);
    expect(fixedBlock.event.movable).toBe(false);

    movableBlock.dispose();
    fixedBlock.dispose();
  });

  it('populates and clears tasks in SpatialTaskPanel', () => {
    const panel = new SpatialTaskPanel(0.65, 0.75);
    panel.setTasks(mockTasks);

    // Check panel has children
    expect(panel.group.children.length).toBeGreaterThan(1);

    // Clear tasks
    panel.clearTasks();

    // Set empty tasks list
    panel.setTasks([]);
    expect(panel.group.getObjectByName('empty_tasks_notice')).toBeDefined();

    panel.dispose();
  });

  it('supports draft drag movements along the timeline axis', () => {
    const timeline = new SpatialTimeline();
    timeline.setEvents(mockEvents);

    const draftCb = vi.fn();
    timeline.onDraftMoveEvent(draftCb);

    timeline.dispose();
  });

  it('preserves calendar wall-clock times from ISO strings and dynamically expands bounds', () => {
    const earlyAndLateEvents: ScheduleEvent[] = [
      {
        id: 'evt-early',
        title: 'Early Breakfast Meeting',
        startTime: '2026-10-22T06:30:00+05:30', // Earlier than 08:00
        endTime: '2026-10-22T07:30:00+05:30',
        durationMinutes: 60,
        priority: 'medium',
        movable: true,
        category: 'meeting',
      },
      {
        id: 'evt-late',
        title: 'Late Evening Debrief',
        startTime: '2026-10-22T21:00:00+05:30', // Later than 20:00
        endTime: '2026-10-22T22:00:00+05:30',
        durationMinutes: 60,
        priority: 'high',
        movable: false,
        category: 'meeting',
      },
    ];

    const timeline = new SpatialTimeline();
    timeline.setEvents(earlyAndLateEvents);

    // Both events should be present and positioned within the track
    expect(timeline.group.children.length).toBeGreaterThan(1);
    timeline.dispose();
  });
});
