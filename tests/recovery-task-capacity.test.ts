import { describe, expect, it } from 'vitest';
import { analyzeConflicts } from '../apps/mcp-server/src/recovery/analyzeConflicts.js';
import { assessTaskCapacity, AT_RISK_SLACK_MINUTES, freeMinutes } from '../apps/mcp-server/src/recovery/taskCapacity.js';
import { at, ev, ms, overrun, task, WINDOW } from './helpers/recoveryFixtures.js';

const horizon = { planStartMs: ms('08:00'), horizonEndMs: ms('18:00') };
const hour = (from: string, to: string) => ({ startMs: ms(from), endMs: ms(to) });
const assess = (tasks: ReturnType<typeof task>[], occupied = [hour('09:00', '10:00')]) => assessTaskCapacity({ ...horizon, tasks, occupied });

describe('assessTaskCapacity', () => {
  it('counts free minutes with merged, clipped occupancy and rounds down', () => {
    expect(freeMinutes([hour('09:00', '10:00'), hour('09:30', '10:30')], ms('08:00'), ms('12:00'))).toBe(150); // 240 min window - 90 min merged occupancy
    expect(freeMinutes([hour('07:00', '09:00')], ms('08:00'), ms('10:00'))).toBe(60);
    expect(freeMinutes([], ms('10:00'), ms('10:00'))).toBe(0);
    expect(freeMinutes([], ms('08:00'), ms('08:00') + 90_000)).toBe(1);
  });

  it('reports sufficient capacity as feasible, with the margin', () => {
    const [a] = assess([task('t', 60, '12:00')]);
    expect(a).toMatchObject({ status: 'feasible', availableMinutes: 180, cumulativeEffortMinutes: 60, slackMinutes: 120 });
    expect(a!.note).toMatch(/does not assign the task a time slot/);
  });

  it('reports insufficient capacity as infeasible', () => {
    const [a] = assess([task('t', 200, '12:00')]);
    expect(a).toMatchObject({ status: 'infeasible', slackMinutes: -20 });
    expect(a!.note).toMatch(/short by 20 min/);
  });

  it('does not call a near deadline violated: ample capacity stays feasible', () => {
    expect(assess([task('t', 10, '09:00')])[0]!.status).toBe('feasible'); // 60 free minutes before 09:00
  });

  it('flags at_risk when the margin is within the threshold', () => {
    expect(assess([task('t', 180 - AT_RISK_SLACK_MINUTES, '12:00')])[0]!.status).toBe('at_risk');
    expect(assess([task('t', 180 - AT_RISK_SLACK_MINUTES - 1, '12:00')])[0]!.status).toBe('feasible');
  });

  it('excludes completed tasks entirely', () => {
    const out = assess([task('done', 500, '12:00', { status: 'completed' }), task('t', 60, '12:00')]);
    expect(out.map((a) => a.task.id)).toEqual(['t']);
    expect(out[0]!.cumulativeEffortMinutes).toBe(60);
  });

  it('counts in_progress tasks at full estimate', () => {
    expect(assess([task('t', 100, '12:00', { status: 'in_progress' })])[0]!.cumulativeEffortMinutes).toBe(100);
  });

  it('accumulates effort across deadlines so free time is never counted twice', () => {
    const out = assess(
      [task('t1', 60, '11:00'), task('t2', 100, '12:00', { priority: 'high' }), task('t3', 50, '12:00', { priority: 'low' })],
      [hour('09:00', '10:00')],
    );
    expect(out.map((a) => [a.task.id, a.cumulativeEffortMinutes, a.availableMinutes, a.status])).toEqual([
      ['t1', 60, 120, 'feasible'],
      ['t2', 160, 180, 'at_risk'],
      ['t3', 210, 180, 'infeasible'],
    ]);
  });

  it('does not assess tasks due after the planning interval', () => {
    const [a] = assess([task('later', 60, '2026-10-23T09:00:00+05:30')]);
    expect(a).toMatchObject({ status: 'not_assessed', availableMinutes: null, slackMinutes: null });
  });

  it('treats a deadline at the interval end as assessable', () => {
    expect(assess([task('end', 60, '18:00')])[0]!.status).toBe('feasible');
  });

  it('reports a deadline that has no time left as infeasible without distorting later tasks', () => {
    const out = assess([task('gone', 30, '08:00'), task('t', 60, '12:00')]);
    expect(out[0]).toMatchObject({ status: 'infeasible', availableMinutes: 0 });
    expect(out[1]!.cumulativeEffortMinutes).toBe(60);
  });
});

describe('task findings: pre-existing vs disruption-caused risk', () => {
  const events = [ev('M', '10:00', '11:00', { movable: false }), ev('X', '14:00', '15:00')];

  it('attributes an already-tight deadline to the stored schedule', () => {
    // Free before 12:00 in the stored schedule: 240 - 60 = 180 min. Effort 170 leaves 10 -> at risk already.
    const out = analyzeConflicts({ ...WINDOW, events, tasks: [task('t', 170, '12:00')] });
    expect(out.taskAssessments[0]).toMatchObject({ status: 'at_risk', baselineStatus: 'at_risk', origin: 'pre_existing' });
    expect(out.existingConflicts.map((c) => c.issueId)).toEqual(['deadline:t']);
    expect(out.newConflicts).toEqual([]);
  });

  it('attributes a deadline pushed to the edge by the overrun to the disruption', () => {
    const tasks = [task('t', 100, '12:00')]; // stored: 180 free, margin 80 -> feasible
    const without = analyzeConflicts({ ...WINDOW, events, tasks });
    expect(without.taskAssessments[0]).toMatchObject({ status: 'feasible', origin: 'none' });

    const out = analyzeConflicts({ ...WINDOW, events, tasks, disruption: overrun('M', 60) }); // 120 free, margin 20
    expect(out.taskAssessments[0]).toMatchObject({ status: 'at_risk', baselineStatus: 'feasible', origin: 'disruption', slackMinutes: 20 });
    expect(out.newConflicts.map((c) => c.issueId)).toEqual(['deadline:t']);
    expect(out.newConflicts[0]!.introducedByDisruption).toBe(true);
  });

  it('flags a deadline made infeasible by the overrun as a new, high-severity conflict', () => {
    const out = analyzeConflicts({ ...WINDOW, events, tasks: [task('t', 150, '12:00', { priority: 'critical' })], disruption: overrun('M', 60) });
    expect(out.taskAssessments[0]).toMatchObject({ status: 'infeasible', origin: 'disruption' });
    expect(out.newConflicts[0]).toMatchObject({ category: 'task_deadline', severity: 'critical' });
  });
});
