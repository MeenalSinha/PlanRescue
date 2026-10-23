import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, getSchemaVersion, LATEST_SCHEMA_VERSION, MIGRATIONS } from '../apps/mcp-server/src/db/migrations.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

describe('Phase 6 Database Migrations & Tables', () => {
  let tmp: TempDatabase;

  beforeEach(() => {
    tmp = makeTempDatabase();
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('migrates fresh database to version 2 with all required tables and indexes', () => {
    const db = new Database(tmp.path);
    try {
      const res = migrate(db);
      expect(res.from).toBe(0);
      expect(res.to).toBe(LATEST_SCHEMA_VERSION);
      expect(res.to).toBe(2);
      expect(getSchemaVersion(db)).toBe(2);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('calendar_events');
      expect(tableNames).toContain('tasks');
      expect(tableNames).toContain('recovery_plans');
      expect(tableNames).toContain('action_history');

      // Verify recovery_plans columns
      const planCols = db.prepare("PRAGMA table_info('recovery_plans')").all() as Array<{ name: string; type: string }>;
      const planColNames = planCols.map((c) => c.name);
      expect(planColNames).toEqual(
        expect.arrayContaining([
          'id',
          'request_id',
          'source_plan_id',
          'status',
          'plan_json',
          'planning_start',
          'planning_end',
          'snapshot_hash',
          'created_at',
          'updated_at',
          'approved_at',
          'rejected_at',
          'applied_at',
        ]),
      );

      // Verify action_history columns
      const histCols = db.prepare("PRAGMA table_info('action_history')").all() as Array<{ name: string; type: string }>;
      const histColNames = histCols.map((c) => c.name);
      expect(histColNames).toEqual(
        expect.arrayContaining([
          'id',
          'recovery_plan_id',
          'action_type',
          'occurred_at',
          'actor',
          'details_json',
        ]),
      );
    } finally {
      db.close();
    }
  });

  it('upgrades an existing version 1 database cleanly to version 2 without losing rows', () => {
    const db = new Database(tmp.path);
    try {
      // Run only migration 1
      MIGRATIONS[0]!.up(db);
      db.pragma('user_version = 1');
      expect(getSchemaVersion(db)).toBe(1);

      // Insert an event into v1
      db.prepare(`
        INSERT INTO calendar_events (id, title, start_time, end_time, start_ms, end_ms, priority, movable, category, notes)
        VALUES ('test-evt-1', 'Existing Event', '2026-10-22T10:00:00+05:30', '2026-10-22T11:00:00+05:30', 1000, 2000, 'medium', 1, 'meeting', 'notes')
      `).run();

      // Migrate from v1 to latest
      const res = migrate(db);
      expect(res.from).toBe(1);
      expect(res.to).toBe(2);
      expect(getSchemaVersion(db)).toBe(2);

      // Verify existing row is intact
      const existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get('test-evt-1') as { title: string };
      expect(existing).toBeDefined();
      expect(existing.title).toBe('Existing Event');

      // Verify v2 tables were added
      const count = db.prepare('SELECT count(*) as count FROM recovery_plans').get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it('migration is idempotent when run repeatedly', () => {
    const db = new Database(tmp.path);
    try {
      const v1 = migrate(db);
      expect(v1.from).toBe(0);
      expect(v1.to).toBe(2);

      const v2 = migrate(db);
      expect(v2.from).toBe(2);
      expect(v2.to).toBe(2);
    } finally {
      db.close();
    }
  });
});
