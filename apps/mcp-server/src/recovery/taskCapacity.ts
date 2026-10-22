import { toEpochMs } from '../lib/time.js';
import type { Task } from '../types.js';
import { compareText, MS_PER_MINUTE, priorityRank, type Slot } from './schedule.js';
import type { CapacityStatus, RiskOrigin, TaskFinding } from './types.js';

/**
 * Aggregate task-capacity assessment.
 *
 * Tasks have an effort and a deadline but no calendar slot, and this module never invents one. It
 * answers a coarser question: is there enough unoccupied calendar time before each deadline to hold
 * the cumulative remaining effort of every unfinished task due by then?
 *
 * Assumptions (also documented in the README):
 *  - Pending and in-progress tasks count with their full estimatedDurationMinutes as remaining effort;
 *    there is no progress tracking yet. Completed tasks are ignored.
 *  - Free time is the part of [planning start, deadline) not covered by any calendar event. Every
 *    event occupies time, including focus and deadline-work blocks, so those blocks are NOT counted as
 *    capacity. The estimate is therefore conservative.
 *  - Effort is cumulative in deadline order (then priority, then id), so the same free minute is never
 *    offered to two tasks.
 *  - Tasks due after the planning interval ends are not assessed: calendar data beyond it is not loaded.
 *  - A task whose deadline is at or before the planning start cannot be done in the future and is
 *    reported infeasible; it is left out of the cumulative sums so it cannot distort later tasks.
 *  - "feasible" means capacity exists, not that a slot has been assigned or that the work will be done.
 *  - The disrupted schedule is assessed as "stored schedule, with the overrun's minutes paid in full":
 *    the part of the extra time that falls before a deadline is subtracted from the free time. Using the
 *    union of overlapping events instead would double-count the overlapped minutes and make the
 *    disruption look cheaper than it is; resolving an overlap is unavoidable, so it is never blamed on a plan.
 */

/** A task is "at risk" when the free time exceeds the effort by no more than this many minutes. */
export const AT_RISK_SLACK_MINUTES = 30;

export interface Interval {
  startMs: number;
  endMs: number;
}

export interface TaskAssessment {
  task: Task;
  status: CapacityStatus;
  cumulativeEffortMinutes: number | null;
  availableMinutes: number | null;
  slackMinutes: number | null;
  note: string;
}

const statusRank = (status: CapacityStatus): number =>
  status === 'infeasible' ? 2 : status === 'at_risk' ? 1 : 0; // not_assessed ranks with feasible: no known problem

/** Merge overlapping or touching intervals into a sorted, disjoint list. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** Whole unoccupied minutes in [fromMs, toMs): rounded down so capacity is never overstated. */
export function freeMinutes(occupied: readonly Interval[], fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  let occupiedMs = 0;
  for (const block of mergeIntervals(occupied)) {
    const start = Math.max(block.startMs, fromMs);
    const end = Math.min(block.endMs, toMs);
    if (end > start) occupiedMs += end - start;
  }
  return Math.floor((toMs - fromMs - occupiedMs) / MS_PER_MINUTE);
}

export interface CapacityInput {
  tasks: readonly Task[];
  /** Planning start: the instant from which time is available. */
  planStartMs: number;
  /** End of the planning interval: tasks due later are not assessed. */
  horizonEndMs: number;
  /** Calendar occupancy in the schedule being assessed. */
  occupied: readonly Interval[];
  /** Extra time consumed on top of `occupied` (an overrun's extension). The part before a deadline is subtracted. */
  reserved?: Interval | undefined;
}

/** Assess every unfinished task against the occupancy supplied. Output order: deadline, priority, id. */
export function assessTaskCapacity(input: CapacityInput): TaskAssessment[] {
  const unfinished = input.tasks
    .filter((task) => task.status !== 'completed')
    .map((task) => ({ task, deadlineMs: toEpochMs(task.deadline) }))
    .sort(
      (a, b) =>
        a.deadlineMs - b.deadlineMs || priorityRank(a.task.priority) - priorityRank(b.task.priority) || compareText(a.task.id, b.task.id),
    );

  let cumulative = 0;
  return unfinished.map(({ task, deadlineMs }): TaskAssessment => {
    if (deadlineMs > input.horizonEndMs) {
      return {
        task,
        status: 'not_assessed',
        cumulativeEffortMinutes: null,
        availableMinutes: null,
        slackMinutes: null,
        note: 'Deadline is after the end of the planning interval, so calendar capacity up to it was not examined.',
      };
    }
    if (deadlineMs <= input.planStartMs) {
      return {
        task,
        status: 'infeasible',
        cumulativeEffortMinutes: null,
        availableMinutes: 0,
        slackMinutes: null,
        note: 'The deadline is at or before the planning start, so no time remains to do this task.',
      };
    }

    cumulative += task.estimatedDurationMinutes;
    const reservedMs = input.reserved
      ? Math.max(0, Math.min(input.reserved.endMs, deadlineMs) - Math.max(input.reserved.startMs, input.planStartMs))
      : 0;
    const available = Math.max(0, freeMinutes(input.occupied, input.planStartMs, deadlineMs) - Math.floor(reservedMs / MS_PER_MINUTE));
    const slack = available - cumulative;
    const status: CapacityStatus = slack < 0 ? 'infeasible' : slack <= AT_RISK_SLACK_MINUTES ? 'at_risk' : 'feasible';
    const effort = `${cumulative} min of effort is due by this deadline (this task: ${task.estimatedDurationMinutes} min) against ${available} min of unoccupied calendar time`;
    const note =
      status === 'infeasible'
        ? `${effort}: short by ${-slack} min, so the deadline cannot be met under these capacity assumptions.`
        : status === 'at_risk'
          ? `${effort}, leaving only ${slack} min of margin. Capacity exists but any further disruption could break it.`
          : `${effort}, leaving ${slack} min of margin. Capacity exists; this does not assign the task a time slot or mean it will be completed.`;
    return { task, status, cumulativeEffortMinutes: cumulative, availableMinutes: available, slackMinutes: slack, note };
  });
}

export interface FindingsInput {
  tasks: readonly Task[];
  planStartMs: number;
  horizonEndMs: number;
  /** Stored schedule, no disruption. */
  baseline: readonly Slot[];
  /** The overrun's extension [original end, projected end), or undefined with no disruption. */
  overrun?: Interval | undefined;
  /** Schedule under assessment (a proposed plan). Defaults to the disrupted scenario. */
  final?: readonly Slot[] | undefined;
}

/**
 * Assess the tasks under the stored schedule, the disrupted schedule and the final schedule, and
 * attribute any deadline problem to where it comes from:
 *  - pre_existing: already as bad before the disruption;
 *  - disruption: made worse by the overrun itself (no rescheduling can undo an event that ran long): the
 *    stored schedule with the overrun's minutes paid in full is already that bad;
 *  - plan_introduced: made worse by the proposed moves relative to simply letting the overrun happen.
 */
export function assessTaskFindings(input: FindingsInput): TaskFinding[] {
  const common = { tasks: input.tasks, planStartMs: input.planStartMs, horizonEndMs: input.horizonEndMs };
  const baseline = assessTaskCapacity({ ...common, occupied: input.baseline });
  const scenario = assessTaskCapacity({ ...common, occupied: input.baseline, reserved: input.overrun });
  const final = input.final ? assessTaskCapacity({ ...common, occupied: input.final }) : scenario;

  return final.map((assessment, index): TaskFinding => {
    const { task } = assessment;
    const baselineStatus = baseline[index]!.status;
    const scenarioStatus = scenario[index]!.status;
    let origin: RiskOrigin = 'none';
    if (assessment.status === 'at_risk' || assessment.status === 'infeasible') {
      const rank = statusRank(assessment.status);
      origin =
        statusRank(baselineStatus) >= rank ? 'pre_existing' : statusRank(scenarioStatus) >= rank ? 'disruption' : 'plan_introduced';
    }
    return {
      taskId: task.id,
      title: task.title,
      deadline: task.deadline,
      priority: task.priority,
      estimatedDurationMinutes: task.estimatedDurationMinutes,
      status: assessment.status,
      baselineStatus,
      origin,
      cumulativeEffortMinutes: assessment.cumulativeEffortMinutes,
      availableMinutes: assessment.availableMinutes,
      slackMinutes: assessment.slackMinutes,
      note: assessment.note,
    };
  });
}
