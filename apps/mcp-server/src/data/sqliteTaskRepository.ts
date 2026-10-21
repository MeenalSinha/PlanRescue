import type { Db } from '../db/migrations.js';
import { InvalidQueryError } from '../lib/errors.js';
import { TASK_STATUSES, type Task, type TaskQuery, type TaskRepository } from '../types.js';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  estimated_duration_minutes: number;
  deadline: string;
  priority: Task['priority'];
  status: Task['status'];
  created_at: string;
  updated_at: string;
}

/**
 * SQLite-backed task repository.
 *
 * Filters are optional and combine with AND; an omitted filter restricts nothing. The deadline
 * window is [deadlineFromMs, deadlineToMs): inclusive start, exclusive end. Ordering is
 * deterministic: deadline, then priority (critical first), then id.
 */
export class SqliteTaskRepository implements TaskRepository {
  private readonly select;

  constructor(db: Db) {
    // One prepared statement for every filter combination: a NULL parameter means "no restriction".
    this.select = db.prepare<{ status: string | null; fromMs: number | null; toMs: number | null }, TaskRow>(
      `SELECT id, title, description, estimated_duration_minutes, deadline, priority, status, created_at, updated_at
         FROM tasks
        WHERE (@status IS NULL OR status = @status)
          AND (@fromMs IS NULL OR deadline_ms >= @fromMs)
          AND (@toMs   IS NULL OR deadline_ms <  @toMs)
        ORDER BY deadline_ms,
                 CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 id`,
    );
  }

  async findTasks(query: TaskQuery = {}): Promise<Task[]> {
    const { deadlineFromMs, deadlineToMs, status } = query;
    for (const [name, value] of [
      ['deadlineFromMs', deadlineFromMs],
      ['deadlineToMs', deadlineToMs],
    ] as const) {
      if (value !== undefined && !Number.isFinite(value)) {
        throw new InvalidQueryError(`${name} must be a finite epoch-millisecond value`);
      }
    }
    if (deadlineFromMs !== undefined && deadlineToMs !== undefined && deadlineToMs <= deadlineFromMs) {
      throw new InvalidQueryError('endDeadline must be strictly after startDeadline');
    }
    if (status !== undefined && !(TASK_STATUSES as readonly string[]).includes(status)) {
      throw new InvalidQueryError(`status must be one of ${TASK_STATUSES.join(', ')}`);
    }

    return this.select
      .all({ status: status ?? null, fromMs: deadlineFromMs ?? null, toMs: deadlineToMs ?? null })
      .map((row) => ({
        id: row.id,
        title: row.title,
        ...(row.description !== null ? { description: row.description } : {}),
        estimatedDurationMinutes: row.estimated_duration_minutes,
        deadline: row.deadline,
        priority: row.priority,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }
}
