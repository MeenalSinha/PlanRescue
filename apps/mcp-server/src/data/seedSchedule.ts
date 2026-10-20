import { overlaps, toEpochMs } from '../lib/time.js';
import type { ScheduleEvent, ScheduleRepository, TimeRange } from '../types.js';

/** Calendar time zone of the seeded data. Timestamps below carry the matching +05:30 offset. */
export const SEED_TIME_ZONE = 'Asia/Kolkata';

/**
 * Deterministic sample day: Thursday 22 October 2026, Asia/Kolkata (UTC+05:30).
 * Temporary development data; it exists only so the MCP server has real events to serve.
 * It is intentionally self-consistent: no overlaps, every event ends after it starts.
 *
 * The afternoon is built around the PlanRescue pitch: the team meeting overruns, the
 * doctor's appointment must not move, and the deadline work must still get done.
 */
export const seedEvents: readonly ScheduleEvent[] = [
  {
    id: 'evt-001',
    title: 'Team Meeting',
    startTime: '2026-10-22T11:30:00+05:30',
    endTime: '2026-10-22T12:30:00+05:30',
    priority: 'high',
    movable: false,
    category: 'meeting',
    notes: 'Weekly team sync; other attendees are involved',
  },
  {
    id: 'evt-002',
    title: 'Lunch Break',
    startTime: '2026-10-22T12:30:00+05:30',
    endTime: '2026-10-22T13:15:00+05:30',
    priority: 'low',
    movable: true,
    category: 'personal',
  },
  {
    id: 'evt-003',
    title: 'Project Review',
    startTime: '2026-10-22T13:30:00+05:30',
    endTime: '2026-10-22T14:30:00+05:30',
    priority: 'high',
    movable: true,
    category: 'meeting',
    notes: 'Review milestone progress with the project lead',
  },
  {
    id: 'evt-004',
    title: 'Focus Work',
    startTime: '2026-10-22T14:30:00+05:30',
    endTime: '2026-10-22T16:00:00+05:30',
    priority: 'medium',
    movable: true,
    category: 'focus',
    notes: 'Uninterrupted block for deep work',
  },
  {
    id: 'evt-005',
    title: "Doctor's Appointment",
    startTime: '2026-10-22T16:30:00+05:30',
    endTime: '2026-10-22T17:30:00+05:30',
    priority: 'critical',
    movable: false,
    category: 'medical',
    notes: 'Fixed external appointment; must not be moved',
  },
  {
    id: 'evt-006',
    title: 'Project Deadline Work',
    startTime: '2026-10-22T18:00:00+05:30',
    endTime: '2026-10-22T20:00:00+05:30',
    priority: 'critical',
    movable: true,
    category: 'deadline_work',
    notes: 'Final push on the deliverable due at 20:00 IST today',
  },
];

/** Repository backed by an in-memory event list. Swap for a database-backed one later. */
export class SeedScheduleRepository implements ScheduleRepository {
  constructor(private readonly events: readonly ScheduleEvent[] = seedEvents) {}

  async findOverlapping(range: TimeRange): Promise<ScheduleEvent[]> {
    return this.events
      .filter((event) => overlaps(toEpochMs(event.startTime), toEpochMs(event.endTime), range.startMs, range.endMs))
      .sort(
        (a, b) =>
          toEpochMs(a.startTime) - toEpochMs(b.startTime) ||
          toEpochMs(a.endTime) - toEpochMs(b.endTime) ||
          a.id.localeCompare(b.id),
      )
      .map((event) => ({ ...event }));
  }
}
