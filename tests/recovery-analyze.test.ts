import { describe, expect, it } from 'vitest';
import { analyzeConflicts } from '../apps/mcp-server/src/recovery/analyzeConflicts.js';
import { RecoveryInputError } from '../apps/mcp-server/src/lib/errors.js';
import { seedEvents } from '../apps/mcp-server/src/data/seedSchedule.js';
import { seedTasks } from '../apps/mcp-server/src/data/seedTasks.js';
import { at, deepFreeze, ev, overrun, roomyDay, task, WINDOW } from './helpers/recoveryFixtures.js';

const base = { ...WINDOW, tasks: [] as ReturnType<typeof task>[] };

describe('analyzeConflicts: baseline', () => {
  it('reports no conflicts for a clean schedule', () => {
    const out = analyzeConflicts({ ...base, events: [ev('A', '09:00', '10:00'), ev('B', '10:30', '11:00')] });
    expect(out.existingConflicts).toEqual([]);
    expect(out.newConflicts).toEqual([]);
    expect(out.disruption).toBeNull();
    expect(out.assessment.status).toBe('no_conflicts');
    expect(out.eventsExamined).toBe(2);
  });

  it('treats touching events as not overlapping (half-open intervals)', () => {
    const out = analyzeConflicts({ ...base, events: [ev('A', '09:00', '10:00'), ev('B', '10:00', '11:00')] });
    expect(out.existingConflicts).toEqual([]);
  });

  it('finds a pre-existing overlap, with interval, severity and resolvability', () => {
    const out = analyzeConflicts({ ...base, events: [ev('A', '09:00', '10:00', { priority: 'high', movable: false }), ev('B', '09:30', '10:30', { priority: 'low' })] });
    expect(out.existingConflicts).toHaveLength(1);
    const c = out.existingConflicts[0]!;
    expect(c).toMatchObject({
      issueId: 'overlap:A|B',
      category: 'event_overlap',
      severity: 'high',
      introducedByDisruption: false,
      resolvable: true,
      interval: { startTime: at('09:30'), endTime: at('10:00') },
    });
    expect(out.newConflicts).toEqual([]);
    expect(out.affectedEvents.map((e) => e.impact)).toEqual(['existing_conflict', 'existing_conflict']);
  });

  it('marks an overlap between two fixed events unresolvable', () => {
    const out = analyzeConflicts({ ...base, events: [ev('A', '09:00', '10:00', { movable: false }), ev('B', '09:30', '10:30', { priority: 'critical' })] });
    expect(out.existingConflicts[0]!.resolvable).toBe(false);
    expect(out.assessment.status).toBe('conflicts_unresolvable');
  });

  it('is deterministic and stable regardless of input order', () => {
    const events = [ev('B', '09:30', '10:30'), ev('A', '09:00', '10:00')];
    const one = analyzeConflicts({ ...base, events });
    const two = analyzeConflicts({ ...base, events: [...events].reverse() });
    expect(two).toEqual(one);
  });
});

describe('analyzeConflicts: event_overrun disruption', () => {
  it('finds the new overlap a late meeting creates and leaves existing conflicts empty', () => {
    const out = analyzeConflicts({ ...base, events: roomyDay(), disruption: overrun('M', 20) });
    expect(out.existingConflicts).toEqual([]);
    expect(out.newConflicts).toHaveLength(1);
    expect(out.newConflicts[0]).toMatchObject({ issueId: 'overlap:B|M', introducedByDisruption: true, resolvable: true, severity: 'high' });
    expect(out.newConflicts[0]!.interval).toEqual({ startTime: at('11:00'), endTime: at('11:20') });
    expect(out.disruption).toEqual(overrun('M', 20));
    expect(out.affectedEvents).toEqual([expect.objectContaining({ eventId: 'B', impact: 'direct_overlap', canBeRescheduled: true })]);
  });

  it('identifies events affected directly and by cascade when the overrun hits several', () => {
    const events = [
      ev('M', '10:00', '11:00', { movable: false, priority: 'high' }),
      ev('L', '11:00', '11:30', { priority: 'low' }),
      ev('N', '11:30', '12:00'),
      ev('P', '12:00', '12:30'),
    ];
    const out = analyzeConflicts({ ...base, events, disruption: overrun('M', 45) });
    expect(out.newConflicts.map((c) => c.issueId).sort()).toEqual(['overlap:L|M', 'overlap:M|N']);
    const impacts = Object.fromEntries(out.affectedEvents.map((e) => [e.eventId, e.impact]));
    expect(impacts).toEqual({ L: 'direct_overlap', N: 'direct_overlap', P: 'cascade' });
  });

  it('reports a conflict with a protected event as critical and unresolvable', () => {
    const events = [ev('M', '10:00', '11:00', { movable: false }), ev('D', '11:15', '12:00', { movable: false, priority: 'critical', title: 'Doctor' })];
    const out = analyzeConflicts({ ...base, events, disruption: overrun('M', 30) });
    expect(out.newConflicts[0]).toMatchObject({ severity: 'critical', resolvable: false, introducedByDisruption: true });
    expect(out.affectedEvents[0]).toMatchObject({ eventId: 'D', canBeRescheduled: false });
    expect(out.assessment.status).toBe('conflicts_unresolvable');
  });

  it('reports no new conflicts when the overrun fits in a gap', () => {
    const out = analyzeConflicts({ ...base, events: roomyDay().map((e) => (e.id === 'B' ? { ...e, startTime: at('11:30'), endTime: at('12:00') } : e)), disruption: overrun('M', 20) });
    expect(out.newConflicts).toEqual([]);
    expect(out.affectedEvents).toEqual([]);
    expect(out.assessment.status).toBe('no_conflicts');
  });

  it('lists protected constraints with reasons, including user-protected and the disrupted event', () => {
    const out = analyzeConflicts({ ...base, events: roomyDay(), disruption: overrun('M', 20), protectedEventIds: ['B'] });
    const reasons = Object.fromEntries(out.protectedConstraints.map((p) => [p.eventId, p.reasons]));
    expect(reasons).toEqual({ M: ['immovable', 'disrupted_event'], B: ['user_protected'], C: ['immovable'] });
    expect(out.newConflicts[0]!.resolvable).toBe(false); // B is now protected too
  });

  it('warns about an unknown protected ID instead of silently ignoring it', () => {
    const out = analyzeConflicts({ ...base, events: roomyDay(), protectedEventIds: ['ghost'] });
    expect(out.warnings.join(' ')).toMatch(/ghost/);
  });

  it('rejects a disruption that names an unknown event', () => {
    expect(() => analyzeConflicts({ ...base, events: roomyDay(), disruption: overrun('nope', 10) })).toThrowError(RecoveryInputError);
    try {
      analyzeConflicts({ ...base, events: roomyDay(), disruption: overrun('nope', 10) });
    } catch (e) {
      expect((e as RecoveryInputError).code).toBe('unknown_event');
    }
  });

  it.each([0, -5, 241, 1.5, Number.NaN])('rejects an invalid overrun duration (%s)', (minutes) => {
    expect(() => analyzeConflicts({ ...base, events: roomyDay(), disruption: overrun('M', minutes) })).toThrowError(/Invalid disruption/);
  });

  it('treats an event outside the planning window as unknown, and warns when the overrun runs past the window', () => {
    const outside = { startTime: at('12:00'), endTime: at('18:00'), tasks: [], events: [] as ReturnType<typeof ev>[] };
    expect(() => analyzeConflicts({ ...outside, disruption: overrun('M', 10) })).toThrowError(/not found/);
    const late = analyzeConflicts({ ...base, endTime: at('11:10'), events: roomyDay().slice(0, 2), disruption: overrun('M', 30) });
    expect(late.warnings.join(' ')).toMatch(/beyond the planning interval/);
  });

  it('rejects inverted, offset-less and oversized intervals', () => {
    expect(() => analyzeConflicts({ ...base, startTime: at('18:00'), endTime: at('08:00'), events: [] })).toThrowError(/strictly after/);
    expect(() => analyzeConflicts({ ...base, startTime: '2026-10-22T08:00:00', events: [] })).toThrowError(/explicit UTC offset/);
    expect(() => analyzeConflicts({ ...base, startTime: '2026-10-01T00:00:00+05:30', endTime: '2026-12-01T00:00:00+05:30', events: [] })).toThrowError(/at most 14 days/);
  });

  it('does not mutate its inputs (the disruption is hypothetical)', () => {
    const events = deepFreeze(roomyDay());
    const tasks = deepFreeze([task('t', 30, '12:00')]);
    expect(() => analyzeConflicts({ ...base, events, tasks, disruption: deepFreeze(overrun('M', 20)) })).not.toThrow();
    expect(events[0]!.endTime).toBe(at('11:00'));
  });
});

describe('analyzeConflicts: the seeded sample workday', () => {
  const seed = { startTime: at('08:00'), endTime: at('20:00'), events: seedEvents, tasks: seedTasks };

  it('has a clean baseline', () => {
    const out = analyzeConflicts(seed);
    expect(out.existingConflicts).toEqual([]);
    expect(out.assessment.status).toBe('no_conflicts');
  });

  it('finds the lunch conflict, cascades to the review and focus work, and keeps the doctor and deadline work fixed', () => {
    const out = analyzeConflicts({ ...seed, disruption: overrun('evt-001', 40) });
    expect(out.newConflicts.map((c) => c.affectedEventIds)).toEqual([['evt-001', 'evt-002']]);
    expect(Object.fromEntries(out.affectedEvents.map((e) => [e.eventId, e.impact]))).toEqual({
      'evt-002': 'direct_overlap',
      'evt-003': 'cascade',
      'evt-004': 'cascade',
    });
    const fixed = out.protectedConstraints.map((p) => p.eventId);
    expect(fixed).toEqual(['evt-001', 'evt-005', 'evt-006']);
  });

  it('assesses the actual tasks: completed excluded, next-day task not assessed, report feasible', () => {
    const out = analyzeConflicts({ ...seed, disruption: overrun('evt-001', 40) });
    expect(out.taskAssessments.map((t) => t.taskId)).toEqual(['task-002', 'task-003', 'task-001', 'task-005']);
    expect(out.taskAssessments.find((t) => t.taskId === 'task-004')).toBeUndefined();
    expect(out.taskAssessments.find((t) => t.taskId === 'task-005')!.status).toBe('not_assessed');
    const report = out.taskAssessments.find((t) => t.taskId === 'task-001')!;
    expect(report).toMatchObject({ status: 'feasible', cumulativeEffortMinutes: 195, origin: 'none' });
    expect(report.note).toMatch(/does not assign|not .*completed|Capacity exists/);
  });
});
