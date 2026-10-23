/**
 * Read-only look at the development database: schema version, row counts and the rows
 * themselves. It opens the file read-only, so it cannot change anything and is safe to run
 * while the server is up.
 *
 *   npm run db:inspect
 *   DATABASE_PATH=/tmp/other.sqlite npm run db:inspect
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { loadConfig } from '../apps/mcp-server/src/config.js';

const { databasePath } = loadConfig();

if (!existsSync(databasePath)) {
  console.error(`No database at ${databasePath}. Start the server once (npm run dev:mcp) to create and seed it.`);
  process.exit(1);
}

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  console.log(`Database: ${databasePath}`);
  console.log(`Schema version (user_version): ${db.pragma('user_version', { simple: true })}`);
  console.log(`Journal mode: ${db.pragma('journal_mode', { simple: true })}`);

  console.log('\ncalendar_events');
  console.table(db.prepare('SELECT id, title, start_time, end_time, priority, movable, category FROM calendar_events ORDER BY start_ms, id').all());
  console.log('\ntasks');
  console.table(
    db
      .prepare('SELECT id, title, estimated_duration_minutes AS minutes, deadline, priority, status FROM tasks ORDER BY deadline_ms, id')
      .all(),
  );

  const planCount = db.prepare('SELECT COUNT(*) as count FROM recovery_plans').get() as { count: number };
  console.log(`\nrecovery_plans (${planCount.count} total)`);
  if (planCount.count > 0) {
    console.table(
      db
        .prepare('SELECT id, request_id, source_plan_id, status, snapshot_hash, approved_at, applied_at, updated_at FROM recovery_plans ORDER BY updated_at DESC LIMIT 10')
        .all(),
    );
  }

  const historyCount = db.prepare('SELECT COUNT(*) as count FROM action_history').get() as { count: number };
  console.log(`\naction_history (${historyCount.count} total)`);
  if (historyCount.count > 0) {
    console.table(
      db
        .prepare('SELECT id, recovery_plan_id, action_type, occurred_at, actor FROM action_history ORDER BY occurred_at DESC LIMIT 10')
        .all(),
    );
  }
} finally {
  db.close();
}
