import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { User, UserPreferences } from './types';

export type Db = Database.Database;

let authDbInstance: Db | null = null;

export function hashPassword(password: string, salt: string = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, combinedHash: string): boolean {
  try {
    const [salt, key] = combinedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const DEFAULT_USER_ID = 'default-user';

export function getAuthDatabase(dbPath?: string): Db {
  if (authDbInstance && !dbPath) {
    return authDbInstance;
  }

  const path = dbPath || process.env.PLANRESCUE_AUTH_DB_PATH || 'data/planrescue-auth.sqlite';
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // fine if exists
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY NOT NULL,
      email        TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash   TEXT PRIMARY KEY NOT NULL,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id                   TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      timezone                  TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      working_days_json         TEXT NOT NULL DEFAULT '["monday","tuesday","wednesday","thursday","friday"]',
      working_hours_start       TEXT NOT NULL DEFAULT '09:00',
      working_hours_end         TEXT NOT NULL DEFAULT '18:00',
      preferred_strategy        TEXT NOT NULL DEFAULT 'minimal_disruption',
      preferred_buffer_minutes  INTEGER NOT NULL DEFAULT 10,
      focus_periods_json        TEXT NOT NULL DEFAULT '[]',
      spatial_comfort_json      TEXT NOT NULL DEFAULT '{"viewDistance":1.4,"handRayEnabled":true,"hapticFeedback":true}',
      updated_at                TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_plan_ownership (
      plan_id      TEXT PRIMARY KEY NOT NULL,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plan_owner ON user_plan_ownership (user_id);

    -- Phase 10 External Calendar tables
    CREATE TABLE IF NOT EXISTS external_calendar_accounts (
      id                      TEXT PRIMARY KEY NOT NULL,
      user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider                TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'local')),
      account_email           TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      access_token            TEXT,
      token_expires_at        TEXT,
      sync_cursor             TEXT,
      sync_status             TEXT NOT NULL DEFAULT 'connected',
      last_synced_at          TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL,
      UNIQUE(user_id, provider, account_email)
    );

    CREATE TABLE IF NOT EXISTS external_calendar_mappings (
      id                TEXT PRIMARY KEY NOT NULL,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      local_event_id    TEXT NOT NULL,
      provider          TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'local')),
      provider_event_id TEXT NOT NULL,
      etag              TEXT,
      last_synced_at    TEXT NOT NULL,
      UNIQUE(user_id, provider, provider_event_id)
    );

    CREATE TABLE IF NOT EXISTS external_sync_outbox (
      id           TEXT PRIMARY KEY NOT NULL,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id      TEXT NOT NULL,
      provider     TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `);

  // Ensure default development user exists ONLY when NOT in production
  if (process.env.NODE_ENV !== 'production') {
    const now = new Date().toISOString();
    const existingDefault = db.prepare('SELECT id FROM users WHERE id = ?').get(DEFAULT_USER_ID);
    if (!existingDefault) {
      const defaultPassHash = hashPassword('PlanRescue2026!');
      db.prepare(`
        INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        DEFAULT_USER_ID,
        'user@planrescue.local',
        defaultPassHash,
        'PlanRescue Studio User',
        now,
        now,
      );

      db.prepare(`
        INSERT OR IGNORE INTO user_preferences (
          user_id, timezone, working_days_json, working_hours_start, working_hours_end,
          preferred_strategy, preferred_buffer_minutes, focus_periods_json,
          spatial_comfort_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        DEFAULT_USER_ID,
        'Asia/Kolkata',
        JSON.stringify(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
        '09:00',
        '18:00',
        'minimal_disruption',
        10,
        JSON.stringify([]),
        JSON.stringify({ viewDistance: 1.4, handRayEnabled: true, hapticFeedback: true }),
        now,
      );
    }
  }

  if (!dbPath) {
    authDbInstance = db;
  }
  return db;
}

export function resetAuthDbForTesting(db: Db): void {
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM external_sync_outbox;
    DELETE FROM external_calendar_mappings;
    DELETE FROM external_calendar_accounts;
    DELETE FROM user_plan_ownership;
    DELETE FROM user_preferences WHERE user_id != '${DEFAULT_USER_ID}';
    DELETE FROM users WHERE id != '${DEFAULT_USER_ID}';
  `);
}
