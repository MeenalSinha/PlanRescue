import { describe, expect, it } from 'vitest';
import { seedEvents } from '../apps/mcp-server/src/data/seedSchedule.js';
import { seedTasks } from '../apps/mcp-server/src/data/seedTasks.js';
import { isoAtOffsetOf, toEpochMs } from '../apps/mcp-server/src/lib/time.js';
import { generateRecoveryPlans } from '../apps/mcp-server/src/recovery/generateRecoveryPlans.js';
import { findOverlaps, toSlot } from '../apps/mcp-server/src/recovery/schedule.js';
import { validateRecoveryPlan } from '../apps/mcp-server/src/recovery/validateRecoveryPlan.js';
import type { ScheduleEvent } from '../apps/mcp-server/src/types.js';
import { at, deepFreeze, ev, overrun, roomyDay, task, WINDOW } from './helpers/recoveryFixtures.js';

const base = { ...WINDOW, tasks: [] as ReturnType<typeof task>[] };

/** Apply a plan's changes to the stored events: used to check the outcome independently of the validator. */
function applyChanges(events: readonly ScheduleEvent[], changes: { eventId: string; proposedStartTime: string; proposedEndTime: string }[], overrunId: string, overrunMin: number) {
  return events.map((e) => {
    const c = changes.find((x) => x.eventId === e.id);
    const end = e.id === overrunId ? toEpochMs(e.endTime) + overrunMin * 60_000 : toEpochMs(e.endTime);
    return c ? { ...e, startTime: c.proposedStartTime, endTime: c.proposedEndTime } : { ...e, endTime: isoAtOffsetOf(e.endTime, end) };
  });
}

describe('generateRecoveryPlans: the seeded sample workday', () => {
  const seed = { startTime: at('08:00'), endTime: at('20:00'), events: seedEvents, tasks: seedTasks, disruption: overrun('evt-001', 40) };
  const set = generateRecoveryPlans(seed);

  it('returns an independently validated plan', () => {
    expect(set.outcome).toBe('plans_found');
    expect(set.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of set.candidates) {
      expect(c.validation.isValid).toBe(true);
      expect(c.validation.violations).toEqual([]);
      expect(c.score.hardViolations).toBe(0);
    }
  });

  it('shifts the affected flexible events later, derived from the overrun rather than hardcoded', () => {
    const plan = set.candidates[0]!;
    expect(plan.strategy).toBe('minimal_disruption');
    expect(plan.changes.map((c) => c.eventId)).toEqual(['evt-002', 'evt-003', 'evt-004']);
    const meetingProjectedEnd = toEpochMs(seedEvents[0]!.endTime) + 40 * 60_000;
    expect(toEpochMs(plan.changes[0]!.proposedStartTime)).toBe(meetingProjectedEnd); // lunch starts when the meeting ends
    // Each event follows the previous one with no gap and no overlap.
    expect(toEpochMs(plan.changes[1]!.proposedStartTime)).toBe(toEpochMs(plan.changes[0]!.proposedEndTime));
    expect(toEpochMs(plan.changes[2]!.proposedStartTime)).toBe(toEpochMs(plan.changes[1]!.proposedEndTime));
    // The result fits before the doctor's appointment.
    expect(toEpochMs(plan.changes[2]!.proposedEndTime)).toBeLessThanOrEqual(toEpochMs(seedEvents[4]!.startTime));
  });

  it('preserves durations, never moves earlier, and leaves protected events and unaffected events alone', () => {
    const plan = set.candidates[0]!;
    for (const c of plan.changes) {
      expect(toEpochMs(c.proposedEndTime) - toEpochMs(c.proposedStartTime)).toBe(toEpochMs(c.originalEndTime) - toEpochMs(c.originalStartTime));
      expect(toEpochMs(c.proposedStartTime)).toBeGreaterThanOrEqual(toEpochMs(c.originalStartTime));
      expect(c.proposedStartTime.endsWith('+05:30')).toBe(true); // the calendar's offset is preserved
    }
    expect(plan.changes.map((c) => c.eventId)).not.toContain('evt-001'); // the overrunning event is not "moved"
    expect(plan.changes.map((c) => c.eventId)).not.toContain('evt-005'); // doctor
    expect(plan.changes.map((c) => c.eventId)).not.toContain('evt-006'); // deadline work
    expect(plan.unchangedProtectedEvents.map((p) => p.eventId)).toEqual(['evt-001', 'evt-005', 'evt-006']);
  });

  it('produces a schedule without overlaps (checked independently of the validator)', () => {
    const final = applyChanges(seedEvents, set.candidates[0]!.changes, 'evt-001', 40);
    expect(findOverlaps(final.map(toSlot))).toEqual([]);
  });

  it('assesses actual task capacity without claiming the work is done', () => {
    const plan = set.candidates[0]!;
    expect(plan.taskAssessments.map((t) => [t.taskId, t.status])).toEqual([
      ['task-002', 'feasible'],
      ['task-003', 'feasible'],
      ['task-001', 'feasible'],
      ['task-005', 'not_assessed'],
    ]);
    expect(plan.explanation.taskCapacity.join(' ')).toMatch(/does not mean any task has been completed/);
  });

  it('explains only what was computed, and discards strategies that cannot work with the reason', () => {
    const plan = set.candidates[0]!;
    expect(plan.summary).toMatch(/Lunch Break, Project Review, Focus Work/);
    expect(plan.explanation.limitations.join(' ')).toMatch(/Only 5 minutes separate Focus Work and Doctor/);
    expect(set.discardedStrategies.map((d) => d.strategy).sort()).toEqual(['buffered_transitions', 'priority_first']);
    for (const d of set.discardedStrategies) expect(d.reason).toMatch(/planning interval closes/);
  });

  it('is deterministic and independent of input order', () => {
    const again = generateRecoveryPlans({ ...seed, events: [...seedEvents].reverse(), tasks: [...seedTasks].reverse() });
    expect(JSON.stringify(again)).toBe(JSON.stringify(set));
    expect(set.candidates[0]!.planId).toMatch(/^plan-[0-9a-f]{12}$/);
  });

  it('never mutates its inputs', () => {
    expect(() => generateRecoveryPlans({ ...seed, events: deepFreeze([...seedEvents]), tasks: deepFreeze([...seedTasks]) })).not.toThrow();
  });
});

describe('generateRecoveryPlans: alternatives and ranking', () => {
  const input = { ...base, events: roomyDay(), disruption: overrun('M', 20) };

  it('needs only the one change that is required', () => {
    const set = generateRecoveryPlans(input);
    expect(set.candidates[0]!.changes.map((c) => c.eventId)).toEqual(['B']);
    expect(set.candidates[0]!.changes[0]).toMatchObject({ proposedStartTime: at('11:20'), proposedEndTime: at('11:50') });
  });

  it('offers a buffered alternative that trades extra delay for breathing room, and drops identical ones', () => {
    const set = generateRecoveryPlans(input);
    expect(set.candidates.map((c) => c.strategy)).toEqual(['minimal_disruption', 'buffered_transitions']);
    const buffered = set.candidates[1]!;
    expect(buffered.changes[0]).toMatchObject({ proposedStartTime: at('11:30'), proposedEndTime: at('12:00') });
    expect(set.discardedStrategies).toEqual([
      expect.objectContaining({ strategy: 'priority_first', reason: expect.stringMatching(/same changes as minimal_disruption/) }),
    ]);
    expect(set.candidates.map((c) => c.score.rank)).toEqual([1, 2]);
  });

  it('lets a transition-time preference reorder candidates but never touch validity', () => {
    const def = generateRecoveryPlans(input);
    const pref = generateRecoveryPlans({ ...input, preferences: { optimizeFor: 'transition_time' } });
    expect(def.candidates[0]!.strategy).toBe('minimal_disruption');
    expect(pref.candidates[0]!.strategy).toBe('buffered_transitions');
    expect(pref.candidates.every((c) => c.validation.isValid && c.score.hardViolations === 0)).toBe(true);
  });

  it('produces a priority-first alternative when priorities differ', () => {
    // M overruns into L (low, 11:00-12:00). H (high, 11:30-12:30) overlaps L's would-be slot: chronological
    // pushes L then H; priority-first lets H keep its slot and pushes L past it.
    const events = [
      ev('M', '10:00', '11:00', { movable: false, priority: 'high' }),
      ev('L', '11:00', '11:30', { priority: 'low' }),
      ev('H', '11:40', '12:40', { priority: 'high' }),
    ];
    const set = generateRecoveryPlans({ ...base, events, disruption: overrun('M', 30) });
    const byStrategy = Object.fromEntries(set.candidates.map((c) => [c.strategy, c.changes.map((x) => x.eventId)]));
    expect(byStrategy['minimal_disruption']).toEqual(['L', 'H']);
    expect(byStrategy['priority_first']).toEqual(['L']);
    expect(set.candidates[0]!.strategy).toBe('priority_first'); // one change beats two
  });

  it('reports "no changes needed" when the overrun displaces nothing', () => {
    const events = roomyDay().map((e) => (e.id === 'B' ? { ...e, startTime: at('12:00'), endTime: at('12:30') } : e));
    const set = generateRecoveryPlans({ ...base, events, disruption: overrun('M', 20) });
    expect(set.outcome).toBe('no_changes_needed');
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0]!.changes).toEqual([]);
    expect(set.candidates[0]!.validation.isValid).toBe(true);
  });
});

describe('generateRecoveryPlans: hard constraints and infeasibility', () => {
  it('never moves a critical event, even one marked movable, and says so', () => {
    const events = [ev('M', '10:00', '11:00', { movable: false }), ev('K', '11:00', '12:00', { priority: 'critical', movable: true, title: 'Critical call' })];
    const set = generateRecoveryPlans({ ...base, events, disruption: overrun('M', 15) });
    expect(set.outcome).toBe('infeasible');
    expect(set.candidates).toEqual([]);
    expect(set.infeasibility!.reasons[0]).toMatchObject({ code: 'fixed_conflict', eventIds: ['M', 'K'] });
    expect(set.infeasibility!.summary).toMatch(/hard constraints cannot all be satisfied/);
    expect(set.infeasibility!.summary).toMatch(/critical priority/);
  });

  it('never moves an immovable event', () => {
    const events = [ev('M', '10:00', '11:00', { movable: false }), ev('I', '11:00', '12:00', { movable: false, priority: 'low' })];
    const set = generateRecoveryPlans({ ...base, events, disruption: overrun('M', 15) });
    expect(set.outcome).toBe('infeasible');
    expect(set.infeasibility!.reasons[0]!.code).toBe('fixed_conflict');
  });

  it('honours additional user-protected events', () => {
    const open = generateRecoveryPlans({ ...base, events: roomyDay(), disruption: overrun('M', 20) });
    expect(open.outcome).toBe('plans_found');
    const guarded = generateRecoveryPlans({ ...base, events: roomyDay(), disruption: overrun('M', 20), protectedEventIds: ['B'] });
    expect(guarded.outcome).toBe('infeasible');
    expect(guarded.infeasibility!.summary).toMatch(/user protected/);
  });

  it('lists a protected event among the unchanged protected events of a valid plan', () => {
    const events = [...roomyDay(), ev('Z', '13:00', '13:30', { title: 'Zed' })];
    const set = generateRecoveryPlans({ ...base, events, disruption: overrun('M', 20), protectedEventIds: ['Z'] });
    expect(set.candidates[0]!.unchangedProtectedEvents.map((p) => [p.eventId, p.reasons])).toContainEqual(['Z', ['user_protected']]);
    expect(set.candidates[0]!.changes.map((c) => c.eventId)).not.toContain('Z');
    expect(set.protectedEventIds).toEqual(['Z']);
  });

  it('reports infeasibility when a moved event cannot fit inside the planning interval', () => {
    const set = generateRecoveryPlans({ ...base, endTime: at('11:40'), events: roomyDay().slice(0, 2), disruption: overrun('M', 20) });
    expect(set.outcome).toBe('infeasible');
    expect(set.infeasibility!.reasons.every((r) => r.code === 'no_slot' && r.eventIds[0] === 'B')).toBe(true);
    expect(set.discardedStrategies.length).toBe(3);
  });

  it('rejects an unknown disruption event with a typed error rather than guessing', () => {
    expect(() => generateRecoveryPlans({ ...base, events: roomyDay(), disruption: overrun('ghost', 5) })).toThrowError(/not found/);
  });

  it('does not let a plan that would break a deadline through (validator vetoes)', () => {
    // Moving B out of the way is fine, but the day ends at 12:00: report must stay honest, not a plan.
    const events = roomyDay();
    const set = generateRecoveryPlans({ ...base, events, tasks: [task('t', 30, '11:15')], disruption: overrun('M', 20) });
    for (const c of set.candidates) expect(validateRecoveryPlan(c, { events, tasks: [task('t', 30, '11:15')] }).isValid).toBe(true);
  });

  it('every returned candidate re-validates cleanly through the public validator entry point', () => {
    const events = roomyDay();
    const set = generateRecoveryPlans({ ...base, events, disruption: overrun('M', 20) });
    for (const c of set.candidates) expect(validateRecoveryPlan(c, { events, tasks: [] }).isValid).toBe(true);
  });
});
