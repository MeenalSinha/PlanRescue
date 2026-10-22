import { RecoveryInputError } from '../lib/errors.js';
import { clockTime, isoAtOffsetOf, isoWithOffset, overlaps, toEpochMs } from '../lib/time.js';
import { PRIORITIES, type Priority, type ScheduleEvent, type Task } from '../types.js';
import {
  disruptionSchema,
  MAX_EVENTS_PER_REQUEST,
  MAX_PLANNING_WINDOW_DAYS,
  type Disruption,
} from './types.js';

/**
 * Pure scheduling primitives shared by the analyser, generator and validator. Everything here works on
 * epoch milliseconds and half-open intervals [start, end), using the project's existing time helpers.
 * Nothing in the Recovery Engine reads or writes a database: callers pass events and tasks in.
 */

export const MS_PER_MINUTE = 60_000;

/** An occupied span of time owned by one event. */
export interface Slot {
  id: string;
  startMs: number;
  endMs: number;
}

export type FixedReason = 'immovable' | 'critical_priority' | 'user_protected' | 'disrupted_event';

export const priorityRank = (priority: Priority): number => PRIORITIES.indexOf(priority);

/** Locale-independent string comparison, so ordering never depends on the host's collation. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic event order: start, end, priority (critical first), id. */
export function compareEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  return (
    toEpochMs(a.startTime) - toEpochMs(b.startTime) ||
    toEpochMs(a.endTime) - toEpochMs(b.endTime) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    compareText(a.id, b.id)
  );
}

export function compareSlots(a: Slot, b: Slot): number {
  return a.startMs - b.startMs || a.endMs - b.endMs || compareText(a.id, b.id);
}

export const toSlot = (event: ScheduleEvent): Slot => ({
  id: event.id,
  startMs: toEpochMs(event.startTime),
  endMs: toEpochMs(event.endTime),
});

/**
 * Why the planner must not reschedule an event. An empty list means the event is flexible.
 * Importance (priority), mobility (movable), user intent (protected) and the disruption itself are
 * independent: a high-priority event can be movable, and a low-priority one can be protected.
 */
export function fixedReasons(
  event: ScheduleEvent,
  protectedIds: ReadonlySet<string>,
  disruptedId: string | undefined,
): FixedReason[] {
  const reasons: FixedReason[] = [];
  if (!event.movable) reasons.push('immovable');
  if (event.priority === 'critical') reasons.push('critical_priority');
  if (protectedIds.has(event.id)) reasons.push('user_protected');
  if (event.id === disruptedId) reasons.push('disrupted_event');
  return reasons;
}

export interface OverlapPair {
  a: Slot;
  b: Slot;
  /** Intersection of the two slots, [startMs, endMs). */
  startMs: number;
  endMs: number;
}

export const pairKey = (aId: string, bId: string): string => (aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`);

/** Every pair of slots that overlap (touching boundaries do not), in deterministic order. */
export function findOverlaps(slots: readonly Slot[]): OverlapPair[] {
  const sorted = [...slots].sort(compareSlots);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      // Sorted by start: once b starts at or after a ends, no later slot can overlap a either.
      if (b.startMs >= a.endMs) break;
      if (overlaps(a.startMs, a.endMs, b.startMs, b.endMs)) {
        pairs.push({ a, b, startMs: Math.max(a.startMs, b.startMs), endMs: Math.min(a.endMs, b.endMs) });
      }
    }
  }
  return pairs;
}

/** Whole minutes in a span of milliseconds (rounded; event times are minute-aligned in practice). */
export const minutesOf = (ms: number): number => Math.round(ms / MS_PER_MINUTE);

// ---------------------------------------------------------------------------------------------
// Planning context
// ---------------------------------------------------------------------------------------------

export interface PlanningInput {
  /** Planning interval start, ISO 8601 with explicit offset. Also the "now" for task-capacity maths. */
  startTime: string;
  endTime: string;
  /** Calendar events overlapping the interval, as returned by a ScheduleRepository. */
  events: readonly ScheduleEvent[];
  /** Tasks as returned by a TaskRepository. Completed tasks are ignored. */
  tasks: readonly Task[];
  disruption?: Disruption | undefined;
  protectedEventIds?: readonly string[] | undefined;
}

export interface ResolvedDisruption {
  spec: Disruption;
  event: ScheduleEvent;
  originalEndMs: number;
  projectedEndMs: number;
  /** Projected end, in the same UTC offset as the event's stored end. */
  projectedEndTime: string;
}

export interface PlanningContext {
  window: { startTime: string; endTime: string; startMs: number; endMs: number };
  /** Stored events in deterministic order. */
  events: ScheduleEvent[];
  byId: ReadonlyMap<string, ScheduleEvent>;
  tasks: readonly Task[];
  /** Stored schedule, exactly as saved. */
  baseline: Slot[];
  /** Stored schedule with the overrun applied to the target's end. Equal to baseline with no disruption. */
  projected: Slot[];
  disruption: ResolvedDisruption | null;
  /** Caller-supplied protected IDs that exist in the interval. */
  protectedIds: ReadonlySet<string>;
  warnings: string[];
}

export function checkPlanningWindow(startTime: string, endTime: string): { startMs: number; endMs: number } {
  for (const [label, value] of [
    ['startTime', startTime],
    ['endTime', endTime],
  ] as const) {
    if (!isoWithOffset.safeParse(value).success) {
      throw new RecoveryInputError('invalid_interval', `${label} must be an ISO 8601 timestamp with an explicit UTC offset.`);
    }
  }
  const startMs = toEpochMs(startTime);
  const endMs = toEpochMs(endTime);
  if (endMs <= startMs) {
    throw new RecoveryInputError('invalid_interval', 'endTime must be strictly after startTime.');
  }
  if (endMs - startMs > MAX_PLANNING_WINDOW_DAYS * 24 * 60 * MS_PER_MINUTE) {
    throw new RecoveryInputError('too_large', `The planning interval may span at most ${MAX_PLANNING_WINDOW_DAYS} days.`);
  }
  return { startMs, endMs };
}

/**
 * Validate the request and build the in-memory scenario. The disruption is applied to a copy of the
 * schedule only. Throws RecoveryInputError for requests that cannot be analysed.
 */
export function buildPlanningContext(input: PlanningInput): PlanningContext {
  const { startMs, endMs } = checkPlanningWindow(input.startTime, input.endTime);
  if (input.events.length > MAX_EVENTS_PER_REQUEST) {
    throw new RecoveryInputError(
      'too_large',
      `The planning interval contains ${input.events.length} events; at most ${MAX_EVENTS_PER_REQUEST} can be planned at once. Use a shorter interval.`,
    );
  }

  const events = [...input.events].sort(compareEvents);
  const byId = new Map<string, ScheduleEvent>();
  for (const event of events) {
    if (byId.has(event.id)) {
      throw new RecoveryInputError('invalid_interval', `Duplicate event id in the calendar data: ${event.id}.`);
    }
    byId.set(event.id, event);
  }

  const warnings: string[] = [];
  const baseline = events.map(toSlot);

  let disruption: ResolvedDisruption | null = null;
  let projected = baseline.map((slot) => ({ ...slot }));
  if (input.disruption) {
    const parsed = disruptionSchema.safeParse(input.disruption);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'disruption'}: ${i.message}`).join('; ');
      throw new RecoveryInputError('invalid_disruption', `Invalid disruption: ${detail}.`);
    }
    const spec = parsed.data;
    const target = byId.get(spec.eventId);
    if (!target) {
      throw new RecoveryInputError(
        'unknown_event',
        `Disruption event "${spec.eventId}" was not found among the calendar events overlapping the planning interval (${input.startTime} to ${input.endTime}).`,
      );
    }
    const originalEndMs = toEpochMs(target.endTime);
    const projectedEndMs = originalEndMs + spec.overrunMinutes * MS_PER_MINUTE;
    disruption = {
      spec,
      event: target,
      originalEndMs,
      projectedEndMs,
      projectedEndTime: isoAtOffsetOf(target.endTime, projectedEndMs),
    };
    projected = projected.map((slot) => (slot.id === target.id ? { ...slot, endMs: projectedEndMs } : slot));
    if (projectedEndMs > endMs) {
      warnings.push(
        `The overrun extends ${target.title} to ${disruption.projectedEndTime}, beyond the planning interval end (${input.endTime}); consequences after the interval are not assessed.`,
      );
    }
  }

  const protectedIds = new Set<string>();
  const unknown: string[] = [];
  for (const raw of input.protectedEventIds ?? []) {
    if (byId.has(raw)) protectedIds.add(raw);
    else unknown.push(raw);
  }
  if (unknown.length > 0) {
    warnings.push(
      `Protected event ID${unknown.length === 1 ? '' : 's'} not found in the planning interval and therefore ignored: ${[...new Set(unknown)].sort(compareText).join(', ')}.`,
    );
  }

  return {
    window: { startTime: input.startTime, endTime: input.endTime, startMs, endMs },
    events,
    byId,
    tasks: input.tasks,
    baseline,
    projected,
    disruption,
    protectedIds,
    warnings,
  };
}

/** Human-readable "HH:mm-HH:mm" for a slot, in the event's own UTC offset. */
export function describeSlot(event: ScheduleEvent, startMs: number, endMs: number): string {
  return `${clockTime(isoAtOffsetOf(event.startTime, startMs))}–${clockTime(isoAtOffsetOf(event.endTime, endMs))}`;
}

/** Label for an event as it stands in the scenario, mentioning the overrun when it is the disrupted event. */
export function describeScenarioEvent(ctx: PlanningContext, event: ScheduleEvent, slot: Slot): string {
  const range = describeSlot(event, slot.startMs, slot.endMs);
  if (ctx.disruption && ctx.disruption.event.id === event.id) {
    return `${event.title} (${range}, after the ${ctx.disruption.spec.overrunMinutes}-minute overrun)`;
  }
  return `${event.title} (${range})`;
}
