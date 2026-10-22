import { describe, expect, it } from 'vitest';
import { generateRecoveryPlans } from '../apps/mcp-server/src/recovery/generateRecoveryPlans.js';
import type { EventChange, RecoveryPlanPayload } from '../apps/mcp-server/src/recovery/types.js';
import { validateRecoveryPlan } from '../apps/mcp-server/src/recovery/validateRecoveryPlan.js';
import { seedEvents } from '../apps/mcp-server/src/data/seedSchedule.js';
import { seedTasks } from '../apps/mcp-server/src/data/seedTasks.js';
import { at, deepFreeze, ev, overrun, roomyDay, task, WINDOW } from './helpers/recoveryFixtures.js';

const events = roomyDay();
const data = { events, tasks: [] as ReturnType<typeof task>[] };
const change = (eventId: string, start: string, end: string, extra: Partial<EventChange> = {}): EventChange => ({
  eventId,
  proposedStartTime: at(start),
  proposedEndTime: at(end),
  ...extra,
});
const plan = (changes: EventChange[], extra: Partial<RecoveryPlanPayload> = {}): RecoveryPlanPayload => ({
  ...WINDOW,
  disruption: overrun('M', 20),
  changes,
  ...extra,
});
const checksFailed = (r: ReturnType<typeof validateRecoveryPlan>) => [...new Set(r.violations.map((v) => v.check))].sort();

describe('validateRecoveryPlan: acceptance', () => {
  it('accepts a correct plan and reports every hard check as passed', () => {
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50')]), data);
    expect(r.isValid).toBe(true);
    expect(r.violations).toEqual([]);
    expect(new Set(r.checks.filter((c) => c.passed).map((c) => c.name)).size).toBe(10);
  });

  it('accepts a plan with no changes when the overrun displaces nothing, and rejects it when it does', () => {
    expect(validateRecoveryPlan(plan([], { disruption: overrun('M', 0 + 1) }), { events: [events[0]!, events[2]!], tasks: [] }).isValid).toBe(true);
    expect(checksFailed(validateRecoveryPlan(plan([]), data))).toEqual(['no_overlaps']);
  });

  it('accepts a plan that includes extra fields, echoes planId, and does not require undocumented transformations', () => {
    const set = generateRecoveryPlans({ ...WINDOW, events, tasks: [], disruption: overrun('M', 20) });
    const candidate = set.candidates[0]!; // passed exactly as returned
    const r = validateRecoveryPlan(candidate, data);
    expect(r.isValid).toBe(true);
    expect(r.planId).toBe(candidate.planId);
  });

  it('does not mutate stored events', () => {
    const frozen = deepFreeze(roomyDay());
    expect(() => validateRecoveryPlan(plan([change('B', '11:20', '11:50')]), { events: frozen, tasks: [] })).not.toThrow();
  });
});

describe('validateRecoveryPlan: rejection of intentionally invalid plans', () => {
  it('rejects an overlap between events', () => {
    const r = validateRecoveryPlan(plan([change('B', '11:10', '11:40')]), data); // still inside the overrun
    expect(r.isValid).toBe(false);
    expect(checksFailed(r)).toEqual(['no_overlaps']);
    expect(r.violations[0]!.message).toMatch(/Meeting.*after the 20-minute overrun.*overlaps Break/);
  });

  it('uses half-open intervals: touching is fine', () => {
    expect(validateRecoveryPlan(plan([change('B', '11:20', '11:50')]), data).isValid).toBe(true);
  });

  it('rejects rescheduling an immovable event', () => {
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50'), change('C', '16:00', '17:00')]), data);
    expect(r.isValid).toBe(false);
    expect(checksFailed(r)).toEqual(['immovable_events']);
    expect(r.violations[0]!.eventId).toBe('C');
  });

  it('rejects changing a critical appointment even when it is movable', () => {
    const ev2 = [...events, ev('K', '12:00', '13:00', { priority: 'critical', movable: true })];
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50'), change('K', '13:00', '14:00')]), { events: ev2, tasks: [] });
    expect(checksFailed(r)).toEqual(['critical_events']);
  });

  it('rejects changing a user-protected event', () => {
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50')], { protectedEventIds: ['B'] }), data);
    expect(checksFailed(r)).toEqual(['protected_events']);
  });

  it('rejects an invalid time range: end before start, equal, and malformed timestamps', () => {
    expect(checksFailed(validateRecoveryPlan(plan([change('B', '11:50', '11:20')]), data))).toContain('valid_time_range');
    expect(checksFailed(validateRecoveryPlan(plan([change('B', '11:20', '11:20')]), data))).toContain('valid_time_range');
    const noOffset = validateRecoveryPlan(plan([{ eventId: 'B', proposedStartTime: '2026-10-22T11:20:00', proposedEndTime: at('11:50') }]), data);
    expect(noOffset.isValid).toBe(false);
    expect(noOffset.violations[0]).toMatchObject({ check: 'valid_time_range', eventId: 'B' });
    // The invalid move cannot be applied, so the overrun overlap also stays unresolved: both are reported.
    const garbage = validateRecoveryPlan(plan([{ eventId: 'B', proposedStartTime: 'garbage', proposedEndTime: at('11:50') }]), data);
    expect(garbage.violations[0]).toMatchObject({ check: 'valid_time_range', eventId: 'B' });
    expect(checksFailed(garbage)).toEqual(['no_overlaps', 'valid_time_range']);
  });

  it('rejects an invalid planning interval and does not crash', () => {
    const r = validateRecoveryPlan(plan([], { startTime: at('18:00'), endTime: at('08:00') }), data);
    expect(r.isValid).toBe(false);
    expect(r.violations[0]!.check).toBe('valid_time_range');
  });

  it('rejects a nonexistent event ID, both as a change and as the disruption target', () => {
    const r = validateRecoveryPlan(plan([change('ghost', '11:20', '11:50')]), data);
    // The plan's only change is to a nonexistent event, so the real overlap with the overrun is also left unresolved.
    expect(r.violations[0]).toMatchObject({ check: 'event_existence', eventId: 'ghost' });
    expect(checksFailed(r)).toEqual(['event_existence', 'no_overlaps']);
    const t = validateRecoveryPlan(plan([], { disruption: overrun('ghost', 10) }), data);
    expect(t.violations[0]).toMatchObject({ check: 'event_existence', eventId: 'ghost' });
  });

  it('rejects an event-duration change (shortening is not a hidden workaround)', () => {
    const shorter = validateRecoveryPlan(plan([change('B', '11:20', '11:40')]), data);
    expect(checksFailed(shorter)).toEqual(['duration_preservation']);
    expect(shorter.violations[0]!.message).toMatch(/30 to 20 minutes/);
    expect(checksFailed(validateRecoveryPlan(plan([change('B', '11:20', '12:20')]), data))).toEqual(['duration_preservation']);
  });

  it('rejects listing the overrunning event as a change', () => {
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50'), change('M', '10:00', '11:20')]), data);
    expect(r.isValid).toBe(false);
    expect(r.violations.map((v) => v.check)).toContain('consistency');
  });

  it('rejects a move outside the planning interval', () => {
    expect(checksFailed(validateRecoveryPlan(plan([change('B', '17:45', '18:15')]), data))).toEqual(['scope_validity']);
  });

  it('rejects a plan whose claims about the original schedule are wrong, and a duplicated change', () => {
    const stale = validateRecoveryPlan(plan([change('B', '11:20', '11:50', { originalStartTime: at('09:00') })]), data);
    expect(checksFailed(stale)).toEqual(['consistency']);
    const dup = validateRecoveryPlan(plan([change('B', '11:20', '11:50'), change('B', '12:00', '12:30')]), data);
    expect(checksFailed(dup)).toEqual(['consistency']);
  });

  it('rejects a plan that breaks the rules even though it claims to have passed validation', () => {
    const forged = plan([change('B', '11:10', '11:40'), change('C', '16:00', '17:00')], { validation: { isValid: true } });
    const r = validateRecoveryPlan(forged, data);
    expect(r.isValid).toBe(false);
    expect(checksFailed(r)).toEqual(['immovable_events', 'no_overlaps']);
    expect(r.warnings.some((w) => /claimed validation\.isValid=true/.test(w.message))).toBe(true);
  });

  it('reports an overlap the plan leaves in place from the stored schedule', () => {
    const clash = [ev('P', '09:00', '10:00'), ev('Q', '09:30', '10:30'), ev('M', '12:00', '13:00', { movable: false })];
    const r = validateRecoveryPlan(plan([], { disruption: overrun('M', 10) }), { events: clash, tasks: [] });
    expect(r.isValid).toBe(false);
    expect(r.violations[0]!.message).toMatch(/already present in the stored schedule/);
  });
});

describe('validateRecoveryPlan: task deadlines', () => {
  it('distinguishes a pre-existing risk from a disruption-caused one, as warnings rather than violations', () => {
    const tasks = [task('pre', 175, '12:00'), task('later', 100, '16:00', { priority: 'low' })];
    const dayEvents = [ev('M', '10:00', '11:00', { movable: false }), ev('B', '11:00', '11:30'), ev('X', '14:00', '15:00', { movable: false })];
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50')]), { events: dayEvents, tasks });
    expect(r.isValid).toBe(true);
    const by = Object.fromEntries(r.taskAssessments.map((t) => [t.taskId, t.origin]));
    expect(by['pre']).toBe('pre_existing');
    expect(r.warnings.some((w) => w.taskId === 'pre' && /already the case/.test(w.message))).toBe(true);
  });

  it('treats a deadline made infeasible by the overrun itself as a warning, not a plan fault', () => {
    const dayEvents = [ev('M', '10:00', '11:00', { movable: false }), ev('B', '11:00', '11:30')];
    const r = validateRecoveryPlan(plan([change('B', '11:20', '11:50')], { disruption: overrun('M', 20) }), { events: dayEvents, tasks: [task('tight', 170, '12:00')] });
    expect(r.isValid).toBe(true); // stored: 240-60 = 180 free (feasible); the overrun costs 20 min, leaving 160 < 170: reported, not blamed on the plan
    expect(r.taskAssessments[0]!.status).toBe('infeasible');
    expect(r.taskAssessments[0]!.origin).not.toBe('plan_introduced');
  });

  it('rejects a plan that itself introduces a deadline infeasibility (a move into time before the deadline)', () => {
    // Stored: X is after the 12:00 deadline. A hand-built plan pulls it into the pre-deadline window.
    const dayEvents = [ev('M', '10:00', '11:00', { movable: false }), ev('X', '13:00', '15:00', { title: 'Long job' })];
    const tasks = [task('t', 130, '12:00')]; // stored: 240-60=180 free, margin 50 -> feasible; overrun alone: 179, margin 49
    // X moves to start exactly when the overrun ends (11:01), so no overlap; it now occupies 11:01-12:00 before the deadline: 120 free < 130.
    const r = validateRecoveryPlan(plan([change('X', '11:01', '13:01')], { disruption: overrun('M', 1) }), { events: dayEvents, tasks });
    expect(r.isValid).toBe(false);
    const v = r.violations.find((x) => x.check === 'deadline_feasibility')!;
    expect(v.taskId).toBe('t');
    expect(v.message).toMatch(/the proposed moves cause this/);
    expect(r.taskAssessments[0]).toMatchObject({ status: 'infeasible', baselineStatus: 'feasible', origin: 'plan_introduced' });
  });
});

describe('validateRecoveryPlan on the seeded day', () => {
  const seed = { events: seedEvents, tasks: seedTasks };
  const seedPlan = (changes: EventChange[]): RecoveryPlanPayload => ({
    startTime: at('08:00'),
    endTime: at('20:00'),
    disruption: overrun('evt-001', 40),
    changes,
  });
  const c = (id: string, s: string, e: string) => ({ eventId: id, proposedStartTime: at(s), proposedEndTime: at(e) });

  it('accepts the hand-derived afternoon shift and rejects moving the doctor or ignoring the overlap', () => {
    const good = [c('evt-002', '13:10', '13:55'), c('evt-003', '13:55', '14:55'), c('evt-004', '14:55', '16:25')];
    expect(validateRecoveryPlan(seedPlan(good), seed).isValid).toBe(true);
    expect(validateRecoveryPlan(seedPlan([...good, c('evt-005', '17:00', '18:00')]), seed).isValid).toBe(false);
    expect(validateRecoveryPlan(seedPlan([]), seed).isValid).toBe(false);
    // Focus Work running into the doctor's appointment.
    const tooLate = [c('evt-002', '13:10', '13:55'), c('evt-003', '13:55', '14:55'), c('evt-004', '15:15', '16:45')];
    expect(checksFailed(validateRecoveryPlan(seedPlan(tooLate), seed))).toEqual(['no_overlaps']);
  });
});
