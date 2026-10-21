import type { Db } from '../db/migrations.js';
import { InvalidQueryError } from '../lib/errors.js';
import { validateRange } from '../lib/time.js';
import type { ScheduleEvent, ScheduleRepository, TimeRange } from '../types.js';

interface EventRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  priority: ScheduleEvent['priority'];
  movable: number;
  category: ScheduleEvent['category'];
  notes: string | null;
}

/**
 * SQLite-backed calendar repository. Same contract and overlap rule as the in-memory one:
 * an event overlaps [startMs, endMs) when event.start < endMs AND event.end > startMs, so
 * touching intervals do not overlap. Comparison happens on the integer instants, never on
 * the offset-bearing text, which keeps results correct for any UTC offset.
 */
export class SqliteScheduleRepository implements ScheduleRepository {
  private readonly overlapping;

  constructor(db: Db) {
    this.overlapping = db.prepare<[number, number], EventRow>(
      `SELECT id, title, start_time, end_time, priority, movable, category, notes
         FROM calendar_events
        WHERE start_ms < ? AND end_ms > ?
        ORDER BY start_ms, end_ms, id`,
    );
  }

  async findOverlapping(range: TimeRange): Promise<ScheduleEvent[]> {
    if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) {
      throw new InvalidQueryError('Time range bounds must be finite epoch milliseconds');
    }
    const rangeError = validateRange(range);
    if (rangeError) throw new InvalidQueryError(rangeError);

    return this.overlapping.all(range.endMs, range.startMs).map((row) => ({
      id: row.id,
      title: row.title,
      startTime: row.start_time,
      endTime: row.end_time,
      priority: row.priority,
      movable: row.movable === 1,
      category: row.category,
      ...(row.notes !== null ? { notes: row.notes } : {}),
    }));
  }
}
