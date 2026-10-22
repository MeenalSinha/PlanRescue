import { overlaps } from '../lib/time.js';
import type { Priority, ScheduleEvent } from '../types.js';
import {
  compareSlots,
  compareText,
  findOverlaps,
  fixedReasons,
  MS_PER_MINUTE,
  priorityRank,
  type OverlapPair,
  type PlanningContext,
  type Slot,
} from './schedule.js';

/**
 * Deterministic placement of flexible events around fixed ones.
 *
 * Rules (all hard, none relaxed by any strategy):
 *  - Fixed events never move: immovable, critical, user-protected, and the event that overran
 *    (which occupies its start through its projected end).
 *  - A flexible event that does not overlap anything stays exactly where it is.
 *  - A flexible event that must move keeps its duration, never moves earlier than its original start,
 *    and lands at the earliest start that overlaps nothing (optionally keeping a buffer) and ends
 *    within the planning interval.
 *
 * This is a greedy, order-driven heuristic. It is deterministic, and it reports failure rather than
 * relaxing a constraint. It does NOT prove that its result uses the fewest moves or the least delay.
 */

export interface FlexibleEvent {
  id: string;
  title: string;
  priority: Priority;
  category: ScheduleEvent['category'];
  startMs: number;
  endMs: number;
}

export interface PlacementProblem {
  window: { startMs: number; endMs: number };
  /** Slots that cannot move, with the overrun already applied to the disrupted event. */
  fixed: Slot[];
  flexible: FlexibleEvent[];
}

export type PlacementOrder = 'chronological' | 'priority';

export interface Placement {
  id: string;
  startMs: number;
  endMs: number;
  /** Events that occupied this event's original slot when it was placed, which is why it had to move. */
  blockedBy: string[];
}

export interface PlacementFailure {
  eventId: string;
  reason: string;
}

export interface PlacementOutcome {
  /** Only events that moved, in the order they were placed. */
  moved: Placement[];
  /** Flexible events left exactly where they were. */
  unchanged: string[];
  failure?: PlacementFailure;
}

export function buildPlacementProblem(ctx: PlanningContext): PlacementProblem {
  const disruptedId = ctx.disruption?.event.id;
  const projectedById = new Map(ctx.projected.map((slot) => [slot.id, slot]));
  const fixed: Slot[] = [];
  const flexible: FlexibleEvent[] = [];
  for (const event of ctx.events) {
    const slot = projectedById.get(event.id)!;
    if (fixedReasons(event, ctx.protectedIds, disruptedId).length > 0) {
      fixed.push({ ...slot });
    } else {
      flexible.push({
        id: event.id,
        title: event.title,
        priority: event.priority,
        category: event.category,
        startMs: slot.startMs,
        endMs: slot.endMs,
      });
    }
  }
  return { window: { startMs: ctx.window.startMs, endMs: ctx.window.endMs }, fixed, flexible };
}

/** Overlaps among events that cannot move. No rescheduling can resolve these. */
export function findFixedConflicts(problem: PlacementProblem): OverlapPair[] {
  return findOverlaps(problem.fixed);
}

function orderFlexible(events: readonly FlexibleEvent[], order: PlacementOrder): FlexibleEvent[] {
  const byTime = (a: FlexibleEvent, b: FlexibleEvent): number => a.startMs - b.startMs || a.endMs - b.endMs || compareText(a.id, b.id);
  return [...events].sort(
    order === 'priority' ? (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || byTime(a, b) : byTime,
  );
}

export function placeFlexibleEvents(
  problem: PlacementProblem,
  options: { order: PlacementOrder; bufferMinutes: number },
): PlacementOutcome {
  const buffer = options.bufferMinutes * MS_PER_MINUTE;
  const blockers: Slot[] = [...problem.fixed].sort(compareSlots);
  const moved: Placement[] = [];
  const unchanged: string[] = [];

  for (const event of orderFlexible(problem.flexible, options.order)) {
    const duration = event.endMs - event.startMs;
    const blockedBy = blockers.filter((b) => overlaps(event.startMs, event.endMs, b.startMs, b.endMs)).map((b) => b.id);

    if (blockedBy.length === 0) {
      blockers.push({ id: event.id, startMs: event.startMs, endMs: event.endMs });
      unchanged.push(event.id);
      continue;
    }

    // Earliest start >= original start (and the interval start) that clears every blocker, plus buffer.
    // Jumping to the latest end among the blockers a candidate collides with is safe: any start between
    // here and there would still overlap that blocker, because the candidate is at least as long.
    let start = Math.max(event.startMs, problem.window.startMs);
    for (;;) {
      const collisions = blockers.filter((b) => overlaps(start, start + duration, b.startMs - buffer, b.endMs + buffer));
      if (collisions.length === 0) break;
      start = Math.max(...collisions.map((b) => b.endMs)) + buffer;
      if (start + duration > problem.window.endMs) break;
    }
    if (start + duration > problem.window.endMs) {
      return {
        moved,
        unchanged,
        failure: {
          eventId: event.id,
          reason:
            `${event.title} would have to end after the planning interval closes; no gap of ${duration / MS_PER_MINUTE} minutes` +
            `${options.bufferMinutes > 0 ? ` (plus ${options.bufferMinutes}-minute buffers)` : ''} is free once fixed events and earlier moves are respected.`,
        },
      };
    }
    const placed: Placement = { id: event.id, startMs: start, endMs: start + duration, blockedBy };
    blockers.push({ id: event.id, startMs: placed.startMs, endMs: placed.endMs });
    moved.push(placed);
  }

  return { moved, unchanged };
}
