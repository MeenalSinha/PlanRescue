import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedEvents } from '../apps/mcp-server/src/data/seedSchedule.js';
import { seedTasks } from '../apps/mcp-server/src/data/seedTasks.js';
import { countRows, initializeDatabase, openDatabase, type Db } from '../apps/mcp-server/src/db/database.js';
import { LATEST_SCHEMA_VERSION, getSchemaVersion, migrate } from '../apps/mcp-server/src/db/migrations.js';
import { seedDatabase } from '../apps/mcp-server/src/db/seed.js';
import { DatabaseInitError } from '../apps/mcp-server/src/lib/errors.js';
import { toEpochMs } from '../apps/mcp-server/src/lib/time.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

let tmp: TempDatabase;
const open: Db[] = [];
const track = (db: Db): Db => (open.push(db), db);

beforeEach(() => {
  tmp = makeTempDatabase();
});
afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close();
  tmp.cleanup();
});

const tableNames = (db: Db): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe('fresh database initialization', () => {
  it('creates the file, both tables and the indexes, at the latest schema version', () => {
    const { db, schemaVersion, seeded } = initializeDatabase(tmp.path);
    track(db);
    expect(schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(['calendar_events', 'tasks']);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(indexes).toEqual(['idx_calendar_events_range', 'idx_tasks_deadline', 'idx_tasks_status_deadline']);
    expect(seeded).toEqual({ eventsInserted: seedEvents.length, tasksInserted: seedTasks.length });
  });

  it('creates missing parent directories', () => {
    const nested = join(tmp.path, '..', 'a', 'b', 'c', 'plan.sqlite');
    track(initializeDatabase(nested).db);
    expect(countRows(track(openDatabase(nested).db)).events).toBe(seedEvents.length);
  });

  it('applies the connection settings the data layer relies on', () => {
    const { db } = initializeDatabase(tmp.path);
    track(db);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('stores each timestamp both as offset-preserving text and as an epoch-millisecond instant', () => {
    const { db } = initializeDatabase(tmp.path);
    track(db);
    const event = db.prepare("SELECT start_time, start_ms, end_time, end_ms FROM calendar_events WHERE id = 'evt-001'").get() as Record<string, unknown>;
    expect(event).toEqual({
      start_time: '2026-10-22T11:30:00+05:30',
      start_ms: Date.parse('2026-10-22T06:00:00Z'),
      end_time: '2026-10-22T12:30:00+05:30',
      end_ms: Date.parse('2026-10-22T07:00:00Z'),
    });
    const task = db.prepare("SELECT deadline, deadline_ms FROM tasks WHERE id = 'task-001'").get() as Record<string, unknown>;
    expect(task).toEqual({ deadline: '2026-10-22T20:00:00+05:30', deadline_ms: toEpochMs('2026-10-22T20:00:00+05:30') });
  });
});

describe('reopening and repeatability', () => {
  it('reopens an existing database without error and keeps the schema version', () => {
    initializeDatabase(tmp.path).db.close();
    const again = initializeDatabase(tmp.path);
    track(again.db);
    expect(again.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(again.db)).toEqual(['calendar_events', 'tasks']);
  });

  it('running migrations repeatedly is a no-op', () => {
    const { db } = openDatabase(tmp.path);
    track(db);
    expect(migrate(db)).toEqual({ from: LATEST_SCHEMA_VERSION, to: LATEST_SCHEMA_VERSION });
    expect(migrate(db)).toEqual({ from: LATEST_SCHEMA_VERSION, to: LATEST_SCHEMA_VERSION });
  });

  it('migrates a brand-new database from version 0', () => {
    const raw = track(new Database(tmp.path));
    expect(getSchemaVersion(raw)).toBe(0);
    expect(migrate(raw)).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION });
  });

  it('refuses a database written by a newer schema instead of touching it', () => {
    const raw = new Database(tmp.path);
    raw.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    raw.close();
    expect(() => openDatabase(tmp.path)).toThrow(DatabaseInitError);
    expect(() => openDatabase(tmp.path)).toThrow(/newer than this build supports/);
  });
});

describe('idempotent seeding', () => {
  it('inserts the sample events and tasks when absent', () => {
    const { db } = initializeDatabase(tmp.path);
    track(db);
    expect(countRows(db)).toEqual({ events: seedEvents.length, tasks: seedTasks.length });
  });

  it('does not create duplicates when initialization runs again', () => {
    initializeDatabase(tmp.path).db.close();
    const second = initializeDatabase(tmp.path);
    track(second.db);
    expect(second.seeded).toEqual({ eventsInserted: 0, tasksInserted: 0 });
    expect(seedDatabase(second.db)).toEqual({ eventsInserted: 0, tasksInserted: 0 });
    expect(countRows(second.db)).toEqual({ events: seedEvents.length, tasks: seedTasks.length });
  });

  it('never overwrites rows that were changed after the first seeding', () => {
    const first = initializeDatabase(tmp.path);
    first.db.prepare("UPDATE tasks SET status = 'completed', title = 'Edited by user', updated_at = '2026-10-22T09:00:00.000Z' WHERE id = 'task-001'").run();
    first.db.prepare("UPDATE calendar_events SET title = 'Renamed', movable = 1 WHERE id = 'evt-005'").run();
    first.db.close();

    const second = initializeDatabase(tmp.path);
    track(second.db);
    expect(second.db.prepare("SELECT status, title, updated_at FROM tasks WHERE id = 'task-001'").get()).toEqual({
      status: 'completed',
      title: 'Edited by user',
      updated_at: '2026-10-22T09:00:00.000Z',
    });
    expect(second.db.prepare("SELECT title, movable FROM calendar_events WHERE id = 'evt-005'").get()).toEqual({ title: 'Renamed', movable: 1 });
  });

  it('keeps user-created rows alongside the seed data', () => {
    const first = initializeDatabase(tmp.path);
    first.db
      .prepare(
        "INSERT INTO tasks (id, title, estimated_duration_minutes, deadline, deadline_ms, priority, status, created_at, updated_at) VALUES ('mine', 'Mine', 10, '2026-10-24T10:00:00+05:30', ?, 'low', 'pending', 'x', 'x')",
      )
      .run(toEpochMs('2026-10-24T10:00:00+05:30'));
    first.db.close();
    track(initializeDatabase(tmp.path).db);
    const db = track(openDatabase(tmp.path).db);
    expect(countRows(db).tasks).toBe(seedTasks.length + 1);
  });

  it('fills in only the missing seed rows', () => {
    const first = initializeDatabase(tmp.path);
    first.db.prepare("DELETE FROM tasks WHERE id = 'task-003'").run();
    first.db.close();
    const second = initializeDatabase(tmp.path);
    track(second.db);
    expect(second.seeded).toEqual({ eventsInserted: 0, tasksInserted: 1 });
  });

  it('produces an isolated scenario per database file', () => {
    const other = makeTempDatabase();
    let b: Db | undefined;
    try {
      const a = track(initializeDatabase(tmp.path).db);
      b = initializeDatabase(other.path).db;
      a.prepare("UPDATE tasks SET status = 'completed' WHERE id = 'task-002'").run();
      a.prepare('DELETE FROM calendar_events').run();
      expect(b.prepare("SELECT status FROM tasks WHERE id = 'task-002'").get()).toEqual({ status: 'pending' });
      expect(countRows(b).events).toBe(seedEvents.length);
      expect(countRows(a).events).toBe(0);
    } finally {
      b?.close();
      other.cleanup();
    }
  });

  it('rolls the whole seeding back when one record is invalid', () => {
    const { db } = openDatabase(tmp.path);
    track(db);
    const bad = [...seedTasks, { ...seedTasks[0]!, id: 'task-bad', estimatedDurationMinutes: 0 }];
    expect(() => seedDatabase(db, seedEvents, bad)).toThrow();
    expect(countRows(db)).toEqual({ events: 0, tasks: 0 });
  });
});

describe('database constraints mirror the TypeScript model', () => {
  const insertTask = (db: Db, over: Record<string, unknown>): void => {
    const row = {
      id: 't',
      title: 'T',
      description: null,
      minutes: 30,
      deadline: '2026-10-22T10:00:00+05:30',
      ms: toEpochMs('2026-10-22T10:00:00+05:30'),
      priority: 'high',
      status: 'pending',
      ...over,
    };
    db.prepare(
      'INSERT INTO tasks (id, title, description, estimated_duration_minutes, deadline, deadline_ms, priority, status, created_at, updated_at) VALUES (@id, @title, @description, @minutes, @deadline, @ms, @priority, @status, @id, @id)',
    ).run(row);
  };

  it.each([
    ['zero duration', { minutes: 0 }],
    ['negative duration', { minutes: -5 }],
    ['fractional duration', { minutes: 2.5 }],
    ['absurdly long duration', { minutes: 10_081 }],
    ['unknown status', { status: 'done' }],
    ['unknown priority', { priority: 'urgent' }],
    ['blank title', { title: '   ' }],
    ['empty id', { id: '' }],
  ])('rejects a task with %s', (_label, over) => {
    const { db } = openDatabase(tmp.path);
    track(db);
    expect(() => insertTask(db, over)).toThrow(/constraint|CHECK|cannot store/i);
  });

  it('accepts a valid task', () => {
    const { db } = openDatabase(tmp.path);
    track(db);
    insertTask(db, {});
    expect(countRows(db).tasks).toBe(1);
  });

  it('rejects duplicate ids', () => {
    const { db } = openDatabase(tmp.path);
    track(db);
    insertTask(db, {});
    expect(() => insertTask(db, {})).toThrow(/UNIQUE|PRIMARY/i);
  });

  it.each([
    ['end before start', { startMs: 2000, endMs: 1000 }],
    ['zero-length event', { startMs: 1000, endMs: 1000 }],
    ['unknown priority', { priority: 'urgent' }],
    ['unknown category', { category: 'party' }],
    ['non-boolean movable', { movable: 2 }],
  ])('rejects a calendar event with %s', (_label, over) => {
    const { db } = openDatabase(tmp.path);
    track(db);
    const row = { id: 'e', title: 'E', startMs: 1000, endMs: 2000, priority: 'high', movable: 1, category: 'meeting', ...over };
    expect(() =>
      db
        .prepare(
          "INSERT INTO calendar_events (id, title, start_time, end_time, start_ms, end_ms, priority, movable, category) VALUES (@id, @title, 'a', 'b', @startMs, @endMs, @priority, @movable, @category)",
        )
        .run(row),
    ).toThrow(/constraint|CHECK/i);
  });
});

describe('initialization failures are reported clearly', () => {
  it('fails when the parent directory cannot be created (a file is in the way)', () => {
    const blocker = join(tmp.path, '..', 'blocker');
    mkdirSync(join(tmp.path, '..'), { recursive: true });
    writeFileSync(blocker, 'not a directory');
    const target = join(blocker, 'plan.sqlite');
    expect(() => initializeDatabase(target)).toThrow(DatabaseInitError);
    expect(() => initializeDatabase(target)).toThrow(/Cannot create the database directory/);
  });

  it('fails when DATABASE_PATH is a directory', () => {
    mkdirSync(tmp.path, { recursive: true });
    expect(() => initializeDatabase(tmp.path)).toThrow(/is a directory/);
  });

  it('fails when the file is not a SQLite database, and leaves it untouched', () => {
    mkdirSync(join(tmp.path, '..'), { recursive: true });
    const content = 'this is definitely not a sqlite database file '.repeat(20);
    writeFileSync(tmp.path, content);
    expect(() => initializeDatabase(tmp.path)).toThrow(DatabaseInitError);
    expect(() => initializeDatabase(tmp.path)).toThrow(/Could not open or initialize the SQLite database/);
    expect(readFileSync(tmp.path, 'utf8')).toBe(content);
  });

  it('never falls back to an in-memory database: a failure throws rather than returning a handle', () => {
    mkdirSync(tmp.path, { recursive: true }); // directory at the database path
    let handle: unknown;
    try {
      handle = initializeDatabase(tmp.path);
    } catch {
      // expected
    }
    expect(handle).toBeUndefined();
  });
});
