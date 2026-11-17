import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseInitError } from '../lib/errors.js';
import type { Logger } from '../logger.js';
import { LATEST_SCHEMA_VERSION, migrate, type Db } from './migrations.js';
import { seedDatabase, type SeedResult } from './seed.js';

export type { Db } from './migrations.js';

export interface InitializedDatabase {
  db: Db;
  path: string;
  schemaVersion: number;
  /** Rows inserted by this initialization (zero on every start after the first). */
  seeded: SeedResult;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Open (creating if necessary) the SQLite file at `path`, apply connection settings and bring
 * the schema up to date. It never falls back to an in-memory database: any failure is thrown
 * as a DatabaseInitError and the file handle is released.
 */
export function openDatabase(path: string): { db: Db; schemaVersion: number } {
  const directory = dirname(path);
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    throw new DatabaseInitError(`Cannot create the database directory ${directory}: ${describe(error)}`, { cause: error });
  }

  try {
    if (statSync(path).isDirectory()) {
      throw new DatabaseInitError(`DATABASE_PATH ${path} is a directory; it must be a file path.`);
    }
  } catch (error) {
    if (error instanceof DatabaseInitError) throw error;
    // ENOENT is fine: the database file is created below. Anything else surfaces when opening.
  }

  let db: Db | undefined;
  try {
    db = new Database(path);
    db.pragma('journal_mode = WAL'); // readers do not block the writer; survives restarts
    db.pragma('synchronous = NORMAL'); // the durable default pairing for WAL
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const { to } = migrate(db);
    return { db, schemaVersion: to };
  } catch (error) {
    try {
      db?.close();
    } catch {
      // The original failure is the useful one.
    }
    throw new DatabaseInitError(`Could not open or initialize the SQLite database at ${path}: ${describe(error)}`, {
      cause: error,
    });
  }
}

export interface InitializeDatabaseOptions {
  seed?: boolean;
}

/**
 * Full startup initialization: open, migrate, and conditionally seed sample records.
 *
 * Production Invariants:
 * - Production databases are NEVER seeded automatically.
 * - Sample data seeding is strictly gated to non-production environments with explicit configuration.
 */
export function initializeDatabase(
  path: string,
  logger?: Logger,
  options?: InitializeDatabaseOptions | boolean,
): InitializedDatabase {
  const { db, schemaVersion } = openDatabase(path);
  try {
    const isProduction =
      process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

    let shouldSeed = false;
    if (typeof options === 'boolean') {
      shouldSeed = options && !isProduction;
    } else if (options && typeof options.seed === 'boolean') {
      shouldSeed = options.seed && !isProduction;
    } else if (isProduction) {
      shouldSeed = false;
    } else if (process.env.SEED_SAMPLE_DATA === 'true') {
      shouldSeed = true;
    } else if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      // In automated test runner, maintain default test fixture behavior unless explicitly turned off
      shouldSeed = true;
    }

    const seeded = shouldSeed
      ? seedDatabase(db)
      : { eventsInserted: 0, tasksInserted: 0 };

    if (shouldSeed) {
      logger?.debug(
        `Database ready: schema v${schemaVersion}/${LATEST_SCHEMA_VERSION}, seeded ${seeded.eventsInserted} events and ${seeded.tasksInserted} tasks`,
      );
    } else {
      logger?.debug(
        `Database ready: schema v${schemaVersion}/${LATEST_SCHEMA_VERSION} (sample data seeding disabled)`,
      );
    }

    return { db, path, schemaVersion, seeded };
  } catch (error) {
    try {
      db.close();
    } catch {
      // ignore
    }
    throw new DatabaseInitError(`Could not initialize or seed the SQLite database at ${path}: ${describe(error)}`, {
      cause: error,
    });
  }
}

export function countRows(db: Db): { events: number; tasks: number } {
  const events = (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n;
  const tasks = (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
  return { events, tasks };
}
