import type Database from 'better-sqlite3';
import { CATEGORIES, MAX_TASK_DURATION_MINUTES, PRIORITIES, TASK_STATUSES } from '../types.js';

export type Db = Database.Database;

export interface Migration {
  version: number;
  description: string;
  up(db: Db): void;
}

/** Render a TypeScript constant list as a SQL IN (...) list. Inputs are compile-time constants, never user input. */
const sqlList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ');

/**
 * Ordered, append-only schema history. The schema version lives in SQLite's `user_version`
 * header field, so there is no extra bookkeeping table. Never edit a released migration;
 * add a new one.
 *
 * Timestamps are stored twice on purpose: the ISO 8601 text with its original UTC offset
 * (what the API returns, so local time is preserved exactly) and an INTEGER epoch-millisecond
 * instant (what queries compare and sort on, so results are correct across time zones).
 * The repositories are the only writers and always derive one from the other.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'calendar_events and tasks tables with indexes',
    up(db) {
      db.exec(`
        CREATE TABLE calendar_events (
          id         TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
          title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
          start_time TEXT NOT NULL,
          end_time   TEXT NOT NULL,
          start_ms   INTEGER NOT NULL,
          end_ms     INTEGER NOT NULL,
          priority   TEXT NOT NULL CHECK (priority IN (${sqlList(PRIORITIES)})),
          movable    INTEGER NOT NULL CHECK (movable IN (0, 1)),
          category   TEXT NOT NULL CHECK (category IN (${sqlList(CATEGORIES)})),
          notes      TEXT,
          CHECK (end_ms > start_ms)
        ) STRICT;
        CREATE INDEX idx_calendar_events_range ON calendar_events (start_ms, end_ms);

        CREATE TABLE tasks (
          id                         TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
          title                      TEXT NOT NULL CHECK (length(trim(title)) > 0),
          description                TEXT,
          estimated_duration_minutes INTEGER NOT NULL
            CHECK (estimated_duration_minutes > 0 AND estimated_duration_minutes <= ${MAX_TASK_DURATION_MINUTES}),
          deadline                   TEXT NOT NULL,
          deadline_ms                INTEGER NOT NULL,
          priority                   TEXT NOT NULL CHECK (priority IN (${sqlList(PRIORITIES)})),
          status                     TEXT NOT NULL CHECK (status IN (${sqlList(TASK_STATUSES)})),
          created_at                 TEXT NOT NULL,
          updated_at                 TEXT NOT NULL
        ) STRICT;
        CREATE INDEX idx_tasks_deadline        ON tasks (deadline_ms);
        CREATE INDEX idx_tasks_status_deadline ON tasks (status, deadline_ms);
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function getSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Bring the database up to the latest schema. Each pending migration runs in its own
 * transaction together with the version bump, so a failure leaves the previous version intact.
 * Calling this on an up-to-date database does nothing.
 */
export function migrate(db: Db): { from: number; to: number } {
  const from = getSchemaVersion(db);
  if (from > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${from} is newer than this build supports (${LATEST_SCHEMA_VERSION}). Upgrade PlanRescue or use a different DATABASE_PATH.`,
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return { from, to: getSchemaVersion(db) };
}
