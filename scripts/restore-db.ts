import Database from 'better-sqlite3';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export interface RestoreResult {
  backupPath: string;
  restoredToPath: string;
  checksumMatched: boolean;
  integrityCheckPassed: boolean;
}

/**
 * Restores a SQLite database from a backup file, validates its SHA-256 checksum
 * against the manifest, swaps the file, and runs PRAGMA integrity_check.
 */
export function restoreDatabase(
  backupPath: string,
  targetDbPath: string = 'data/planrescue.sqlite',
  manifestPath?: string,
): RestoreResult {
  const resolvedBackup = resolve(backupPath);
  const resolvedTarget = resolve(targetDbPath);

  if (!existsSync(resolvedBackup)) {
    throw new Error(`Backup file does not exist: ${resolvedBackup}`);
  }

  // 1. Verify checksum if manifest exists
  let checksumMatched = false;
  const resolvedManifest = manifestPath ? resolve(manifestPath) : `${resolvedBackup}.manifest.json`;
  if (existsSync(resolvedManifest)) {
    const manifest = JSON.parse(readFileSync(resolvedManifest, 'utf8'));
    const buffer = readFileSync(resolvedBackup);
    const computedChecksum = createHash('sha256').update(buffer).digest('hex');

    if (computedChecksum !== manifest.checksumSha256) {
      throw new Error(`Checksum mismatch! Manifest: ${manifest.checksumSha256}, Actual: ${computedChecksum}`);
    }
    checksumMatched = true;
  }

  // 2. Copy backup file to target destination
  copyFileSync(resolvedBackup, resolvedTarget);

  // 3. Run PRAGMA integrity_check on restored database
  const db = new Database(resolvedTarget);
  let integrityCheckPassed = false;
  try {
    const check = db.pragma('integrity_check', { simple: true });
    integrityCheckPassed = check === 'ok';
    if (!integrityCheckPassed) {
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(check)}`);
    }
  } finally {
    db.close();
  }

  return {
    backupPath: resolvedBackup,
    restoredToPath: resolvedTarget,
    checksumMatched,
    integrityCheckPassed,
  };
}

if (process.argv[1] && process.argv[1].endsWith('restore-db.ts')) {
  try {
    const backupFile = process.argv[2];
    const targetFile = process.argv[3] || 'data/planrescue.sqlite';
    if (!backupFile) {
      console.error('Usage: tsx scripts/restore-db.ts <backup-file> [target-db-path]');
      process.exit(1);
    }

    console.log(`Restoring database from ${backupFile} to ${targetFile}...`);
    const res = restoreDatabase(backupFile, targetFile);
    console.log(`[SUCCESS] Database restored successfully. Integrity check passed: ${res.integrityCheckPassed}`);
  } catch (err: any) {
    console.error(`[ERROR] Restore failed: ${err.message}`);
    process.exit(1);
  }
}
