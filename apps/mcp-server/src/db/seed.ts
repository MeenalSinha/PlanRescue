import { seedEvents } from '../data/seedSchedule.js';
import { seedTasks } from '../data/seedTasks.js';
import { toEpochMs } from '../lib/time.js';
import { scheduleEventSchema, taskSchema, type ScheduleEvent, type Task } from '../types.js';
import type { Db } from './migrations.js';

export interface SeedResult {
  eventsInserted: number;
  tasksInserted: number;
}

/**
 * Inserts development/test sample events and tasks into the database.
 * Uses atomic transaction and idempotent INSERT OR IGNORE.
 */
export function seedDatabase(
  db: Db,
  events: readonly ScheduleEvent[] = seedEvents,
  tasks: readonly Task[] = seedTasks,
): SeedResult {
  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO calendar_events
       (id, title, start_time, end_time, start_ms, end_ms, priority, movable, category, notes)
     VALUES (@id, @title, @startTime, @endTime, @startMs, @endMs, @priority, @movable, @category, @notes)`,
  );
  const insertTask = db.prepare(
    `INSERT OR IGNORE INTO tasks
       (id, title, description, estimated_duration_minutes, deadline, deadline_ms, priority, status, created_at, updated_at)
     VALUES (@id, @title, @description, @estimatedDurationMinutes, @deadline, @deadlineMs, @priority, @status, @createdAt, @updatedAt)`,
  );

  return db.transaction((): SeedResult => {
    let eventsInserted = 0;
    let tasksInserted = 0;
    for (const raw of events) {
      const e = scheduleEventSchema.parse(raw);
      eventsInserted += insertEvent.run({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
        startMs: toEpochMs(e.startTime),
        endMs: toEpochMs(e.endTime),
        priority: e.priority,
        movable: e.movable ? 1 : 0,
        category: e.category,
        notes: e.notes ?? null,
      }).changes;
    }
    for (const raw of tasks) {
      const t = taskSchema.parse(raw);
      tasksInserted += insertTask.run({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        estimatedDurationMinutes: t.estimatedDurationMinutes,
        deadline: t.deadline,
        deadlineMs: toEpochMs(t.deadline),
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }).changes;
    }
    return { eventsInserted, tasksInserted };
  })();
}
