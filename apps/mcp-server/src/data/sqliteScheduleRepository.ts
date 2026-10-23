import type { Db } from '../db/migrations.js';
import { InvalidQueryError } from '../lib/errors.js';
import { toEpochMs, validateRange } from '../lib/time.js';
import type { EventChangeUpdate, ScheduleEvent, ScheduleRepository, TimeRange } from '../types.js';

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
  private readonly db: Db;
  private readonly overlapping;
  private readonly updateEventStmt;

  constructor(db: Db) {
    this.db = db;
    this.overlapping = db.prepare<[number, number], EventRow>(
      `SELECT id, title, start_time, end_time, priority, movable, category, notes
         FROM calendar_events
        WHERE start_ms < ? AND end_ms > ?
        ORDER BY start_ms, end_ms, id`,
    );
    this.updateEventStmt = db.prepare(
      `UPDATE calendar_events
          SET start_time = ?, end_time = ?, start_ms = ?, end_ms = ?
        WHERE id = ? AND start_time = ? AND end_time = ?`,
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

  async applyEventChanges(changes: EventChangeUpdate[]): Promise<void> {
    const applyTx = this.db.transaction(() => {
      for (const change of changes) {
        const startMs = toEpochMs(change.proposedStartTime);
        const endMs = toEpochMs(change.proposedEndTime);
        if (endMs <= startMs) {
          throw new Error(`Proposed times for event ${change.eventId} are inverted or zero length`);
        }
        const result = this.updateEventStmt.run(
          change.proposedStartTime,
          change.proposedEndTime,
          startMs,
          endMs,
          change.eventId,
          change.originalStartTime,
          change.originalEndTime,
        );
        if (result.changes !== 1) {
          throw new Error(
            `Failed to update event ${change.eventId}: state mismatch (event moved or deleted since plan was created)`,
          );
        }
      }
    });

    applyTx();
  }
}

