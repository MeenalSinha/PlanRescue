import { describe, expect, it } from 'vitest';
import { analyzeProductivity } from '../src/lib/intelligence/productivityEngine';
import { prepareScenarioForExpandedDisruption } from '../src/lib/intelligence/disruptions';
import type { ScheduleEvent, Task } from '../src/lib/contract';

describe('Spatial Phase 11: Productivity Intelligence Engine', () => {
  const sampleEvents: ScheduleEvent[] = [
    {
      id: 'e1',
      title: 'Morning Sync',
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T09:30:00+05:30',
      durationMinutes: 30,
      priority: 'medium',
      movable: true,
      category: 'meeting',
    },
    {
      id: 'e2',
      title: 'Design Review',
      startTime: '2026-10-22T09:30:00+05:30', // back-to-back with e1!
      endTime: '2026-10-22T10:30:00+05:30',
      durationMinutes: 60,
      priority: 'high',
      movable: true,
      category: 'meeting',
    },
    {
      id: 'e3',
      title: 'Product Sync',
      startTime: '2026-10-22T10:45:00+05:30', // 15 min gap with e2 = fragmented!
      endTime: '2026-10-22T11:45:00+05:30',
      durationMinutes: 60,
      priority: 'high',
      movable: false,
      category: 'meeting',
    },
    {
      id: 'e4',
      title: 'Lunch',
      startTime: '2026-10-22T13:00:00+05:30', // 75 min focus gap with e3
      endTime: '2026-10-22T14:00:00+05:30',
      durationMinutes: 60,
      priority: 'low',
      movable: true,
      category: 'personal',
    },
  ];

  const sampleTasks: Task[] = [
    {
      id: 't1',
      title: 'Submit Architecture RFC',
      deadline: '2026-10-22T18:00:00+05:30',
      estimatedDurationMinutes: 90,
      priority: 'critical',
      status: 'pending',
    },
  ];

  it('calculates deterministic schedule metrics, health score, and flags back-to-back meetings', () => {
    const insights = analyzeProductivity('2026-10-22', sampleEvents, sampleTasks, {
      workingHoursStart: '09:00',
      workingHoursEnd: '18:00',
      preferredBufferMinutes: 10,
    });

    expect(insights.date).toBe('2026-10-22');
    expect(insights.metrics.totalScheduledMinutes).toBe(210); // 30 + 60 + 60 + 60
    expect(insights.metrics.backToBackCount).toBe(1); // e1 -> e2
    expect(insights.metrics.fragmentedMinutes).toBe(15); // e2 -> e3
    expect(insights.metrics.focusTimeMinutes).toBe(75); // e3 -> e4
    expect(insights.metrics.healthScore).toBeLessThan(100);
    expect(insights.metrics.healthScore).toBeGreaterThanOrEqual(10);

    const bufferRec = insights.recommendations.find((r) => r.type === 'buffer_needed');
    expect(bufferRec).toBeDefined();
    expect(bufferRec?.description).toContain('1 consecutive meetings');
  });

  it('rewards balanced schedules with high health score', () => {
    const balancedEvents: ScheduleEvent[] = [
      {
        id: 'b1',
        title: 'Team Standup',
        startTime: '2026-10-22T09:00:00+05:30',
        endTime: '2026-10-22T09:30:00+05:30',
        durationMinutes: 30,
        priority: 'medium',
        movable: true,
        category: 'meeting',
      },
      {
        id: 'b2',
        title: 'Focus Sprint',
        startTime: '2026-10-22T10:30:00+05:30', // 60m focus buffer
        endTime: '2026-10-22T12:30:00+05:30',
        durationMinutes: 120,
        priority: 'high',
        movable: true,
        category: 'focus',
      },
    ];

    const insights = analyzeProductivity('2026-10-22', balancedEvents, []);
    expect(insights.metrics.backToBackCount).toBe(0);
    expect(insights.metrics.fragmentedMinutes).toBe(0);
    expect(insights.metrics.healthScore).toBeGreaterThanOrEqual(90);
    expect(insights.summary).toContain('Healthy Schedule');
  });

  describe('Expanded Disruption Scenarios', () => {
    it('prepares in-memory scenario for time_window_unavailable without mutating db', () => {
      const scenario = prepareScenarioForExpandedDisruption(
        {
          type: 'time_window_unavailable',
          reason: 'Doctor Visit & Travel',
          startTime: '2026-10-22T11:00:00+05:30',
          endTime: '2026-10-22T13:00:00+05:30',
        },
        sampleEvents,
        sampleTasks,
      );

      expect(scenario.effectiveEvents.length).toBe(sampleEvents.length + 1);
      const synthetic = scenario.effectiveEvents.find((e) => e.id.startsWith('synth_block_'));
      expect(synthetic).toBeDefined();
      expect(synthetic?.title).toContain('Doctor Visit & Travel');
      expect(synthetic?.priority).toBe('critical');
      expect(synthetic?.movable).toBe(false);
      expect(scenario.additionalProtectedIds).toContain(synthetic?.id);
    });

    it('prepares in-memory scenario for urgent_task_added', () => {
      const scenario = prepareScenarioForExpandedDisruption(
        {
          type: 'urgent_task_added',
          taskId: 't_emergency_fix',
          title: 'Critical CVE-2026 Hotfix',
          durationMinutes: 120,
          priority: 'critical',
          dueTime: '2026-10-22T17:00:00+05:30',
        },
        sampleEvents,
        sampleTasks,
      );

      expect(scenario.effectiveTasks.length).toBe(sampleTasks.length + 1);
      const injected = scenario.effectiveTasks.find((t) => t.id === 't_emergency_fix');
      expect(injected).toBeDefined();
      expect(injected?.title).toBe('Critical CVE-2026 Hotfix');
      expect(injected?.priority).toBe('critical');
      expect(injected?.estimatedDurationMinutes).toBe(120);
    });
  });
});
