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
  console.log('tasks');
  console.table(
    db
      .prepare('SELECT id, title, estimated_duration_minutes AS minutes, deadline, priority, status FROM tasks ORDER BY deadline_ms, id')
      .all(),
  );
} finally {
  db.close();
}
