import { describe, expect, it, vi } from 'vitest';
import { SpatialComparisonWorkspace } from '../src/comparison/comparisonWorkspace';
import { SpatialValidationExplorer } from '../src/comparison/validationExplorer';
import type { RecoveryPlan, ScheduleEvent } from '../src/api/contracts';

describe('Spatial Recovery Comparison & Explainability (Phase 7)', () => {
  const mockBaselineEvents: ScheduleEvent[] = [
    {
      id: 'evt-1',
      title: 'Sprint Planning',
      startTime: '2026-10-22T09:00:00+05:30',
      endTime: '2026-10-22T10:00:00+05:30',
      durationMinutes: 60,
      priority: 'high',
      movable: true,
      category: 'meeting',
    },
    {
      id: 'evt-2',
      title: 'Design Critique',
      startTime: '2026-10-22T10:00:00+05:30',
      endTime: '2026-10-22T11:00:00+05:30',
      durationMinutes: 60,
      priority: 'medium',
      movable: true,
      category: 'meeting',
    },
  ];

  const mockCandidate: RecoveryPlan = {
    planId: 'plan-strat-1',
    persistentId: 'rec-1',
    savedStatus: 'proposed',
    strategy: 'minimal_disruption',
    summary: 'Shift Design Critique by 30 minutes',
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
        title: 'Design Critique',
        originalStartTime: '2026-10-22T10:00:00+05:30',
        originalEndTime: '2026-10-22T11:00:00+05:30',
        proposedStartTime: '2026-10-22T10:30:00+05:30',
        proposedEndTime: '2026-10-22T11:30:00+05:30',
        reason: 'Shifted forward by 30 minutes to accommodate Sprint Planning overrun',
      },
    ],
    unchangedProtectedEvents: [],
    taskAssessments: [],
    explanation: {
      changes: ['Design Critique shifted by 30 minutes'],
      unchanged: [],
      rationale: ['Minimal disruption shifts fewest meetings'],
      taskCapacity: ['Task deadlines unaffected'],
      limitations: [],
    },
    score: {
      total: 25.0,
      rank: 1,
      hardViolations: 0,
      components: {
        changedEvents: 1,
        priorityWeightedDelay: 10,
        focusTime: 0,
        tightTransitions: 5,
        taskRisk: 0,
      },
      formula: 'total = changedEvents * 10 + priorityDelay * 1.0',
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
          message: 'All events have non-overlapping intervals',
        },
        {
          name: 'Duration Preserved',
          passed: true,
          severity: 'hard',
          eventId: null,
          taskId: null,
          message: 'All moved events preserve original durations',
        },
      ],
      violations: [],
      warnings: [],
      taskAssessments: [],
      summary: 'Candidate passes all validation checks',
    },
  };

  it('renders dual Before-and-After tracks in SpatialComparisonWorkspace', () => {
    const workspace = new SpatialComparisonWorkspace();
    const onSelect = vi.fn();
    workspace.onSelectStrategy(onSelect);

    workspace.setCandidates([mockCandidate], mockBaselineEvents);

    // Initial load auto-selects recommended candidate
    expect(onSelect).toHaveBeenCalledWith(mockCandidate);

    workspace.dispose();
  });

  it('displays individual validation checks in SpatialValidationExplorer', () => {
    const explorer = new SpatialValidationExplorer();
    explorer.displayValidation(mockCandidate.validation);

    expect(explorer.group.children.length).toBeGreaterThan(1);

    explorer.dispose();
  });
});
