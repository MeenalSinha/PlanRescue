import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { backupDatabase } from '../scripts/backup-db.js';
import { restoreDatabase } from '../scripts/restore-db.js';

describe('Spatial Phase 14: SQLite Backup & Restore Verification', () => {
  const testDir = 'data/test-backups';
  const testDbPath = join(testDir, 'test-source.sqlite');
  const restoredDbPath = join(testDir, 'test-restored.sqlite');

  it('performs consistent WAL checkpoint, atomic backup, checksum manifest, and verified restore', () => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    // 1. Create and populate a test database in WAL mode
    const db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        start_time TEXT NOT NULL
      );
      INSERT INTO test_events (id, title, start_time) VALUES ('evt_1', 'Design Review', '2026-10-22T09:00:00Z');
      INSERT INTO test_events (id, title, start_time) VALUES ('evt_2', 'Sprint Demo', '2026-10-22T10:00:00Z');
    `);
    db.close();

    // 2. Perform automated backup
    const backupResult = backupDatabase(testDbPath, testDir);

    expect(existsSync(backupResult.backupPath)).toBe(true);
    expect(existsSync(backupResult.manifestPath)).toBe(true);
    expect(backupResult.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(backupResult.bytes).toBeGreaterThan(0);

    // 3. Restore to a new location and verify integrity
    const restoreResult = restoreDatabase(backupResult.backupPath, restoredDbPath, backupResult.manifestPath);

    expect(restoreResult.checksumMatched).toBe(true);
    expect(restoreResult.integrityCheckPassed).toBe(true);

    // 4. Verify data in restored database
    const restoredDb = new Database(restoredDbPath);
    const rows = restoredDb.prepare('SELECT * FROM test_events ORDER BY id ASC').all() as any[];
    restoredDb.close();

    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('Design Review');
    expect(rows[1].title).toBe('Sprint Demo');

    // 5. Clean up temporary test directory
    rmSync(testDir, { recursive: true, force: true });
  });
});
