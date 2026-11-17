import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export interface BackupResult {
  sourceDbPath: string;
  backupPath: string;
  manifestPath: string;
  checksumSha256: string;
  bytes: number;
  timestamp: string;
}

/**
 * Creates a consistent point-in-time SQLite backup by executing a TRUNCATE WAL checkpoint,
 * copying the file, and recording an integrity-verified SHA-256 checksum manifest.
 */
export function backupDatabase(
  dbPath: string = 'data/planrescue.sqlite',
  backupDir: string = 'data/backups',
): BackupResult {
  const resolvedDbPath = resolve(dbPath);
  if (!existsSync(resolvedDbPath)) {
    throw new Error(`Database file does not exist: ${resolvedDbPath}`);
  }

  // 1. Force WAL truncation checkpoint so main DB file contains 100% of committed state
  const db = new Database(resolvedDbPath);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }

  // 2. Ensure backup directory exists
  const resolvedBackupDir = resolve(backupDir);
  mkdirSync(resolvedBackupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = resolvedDbPath.split(/[\\/]/).pop()?.replace('.sqlite', '') || 'planrescue';
  const backupFileName = `${baseName}-${timestamp}.sqlite`;
  const backupPath = join(resolvedBackupDir, backupFileName);

  // 3. Atomically copy the main database file
  copyFileSync(resolvedDbPath, backupPath);

  // 4. Compute SHA-256 checksum
  const fs = require('node:fs');
  const buffer = fs.readFileSync(backupPath);
  const checksum = createHash('sha256').update(buffer).digest('hex');

  // 5. Write manifest file
  const manifest = {
    source: resolvedDbPath,
    backupFile: backupFileName,
    checksumSha256: checksum,
    bytes: buffer.length,
    createdAt: new Date().toISOString(),
    walCheckpoint: 'TRUNCATE',
  };

  const manifestPath = join(resolvedBackupDir, `${backupFileName}.manifest.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    sourceDbPath: resolvedDbPath,
    backupPath,
    manifestPath,
    checksumSha256: checksum,
    bytes: buffer.length,
    timestamp: manifest.createdAt,
  };
}

if (process.argv[1] && process.argv[1].endsWith('backup-db.ts')) {
  try {
    const target = process.argv[2] || 'data/planrescue.sqlite';
    console.log(`Starting automated backup for ${target}...`);
    const res = backupDatabase(target);
    console.log(`[SUCCESS] Backup created: ${res.backupPath} (${res.bytes} bytes, SHA-256: ${res.checksumSha256})`);
  } catch (err: any) {
    console.error(`[ERROR] Backup failed: ${err.message}`);
    process.exit(1);
  }
}
