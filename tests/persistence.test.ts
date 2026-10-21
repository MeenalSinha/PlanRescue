import { mkdirSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type ServerHandle } from './helpers/serverProcess.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

/**
 * Persistence across restarts, exercised end to end: a real server process, a real SQLite file,
 * and a real MCP client over Streamable HTTP. Nothing is mocked and nothing is called directly.
 * Each test owns a separate temporary database.
 */

type ClientOptions = ConstructorParameters<typeof Client>[1];
const MODERN: ClientOptions = { versionNegotiation: { mode: { pin: '2026-07-28' } } };
const LEGACY: ClientOptions = {};

interface Snapshot {
  events: unknown;
  tasks: unknown;
  eventCount: number;
  taskCount: number;
}

const WHOLE_DAY = { startTime: '2026-10-21T00:00:00+05:30', endTime: '2026-10-24T00:00:00+05:30' };

/** Read the full calendar and task list through MCP, then disconnect. */
async function readEverything(server: ServerHandle, options: ClientOptions = MODERN): Promise<Snapshot> {
  const client = new Client({ name: 'planrescue-persistence-test', version: '0.1.0' }, options);
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  try {
    const events = await client.callTool({ name: 'get_schedule', arguments: WHOLE_DAY });
    const tasks = await client.callTool({ name: 'get_tasks', arguments: {} });
    expect(events.isError).toBeFalsy();
    expect(tasks.isError).toBeFalsy();
    const e = events.structuredContent as { count: number; events: unknown[] };
    const t = tasks.structuredContent as { count: number; tasks: unknown[] };
    return { events: e.events, tasks: t.tasks, eventCount: e.count, taskCount: t.count };
  } finally {
    await client.close();
  }
}

async function callTasks(server: ServerHandle, args: Record<string, unknown>) {
  const client = new Client({ name: 'planrescue-persistence-test', version: '0.1.0' }, MODERN);
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  try {
    const r = await client.callTool({ name: 'get_tasks', arguments: args });
    expect(r.isError).toBeFalsy();
    return r.structuredContent as unknown as { count: number; tasks: Array<{ id: string; status: string; title: string }> };
  } finally {
    await client.close();
  }
}

/** Inspect the database file directly (only while no server is running, or for deliberate outside writes). */
function withDatabase<T>(path: string, fn: (db: Database.Database) => T): T {
  const db = new Database(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const rowCounts = (path: string) =>
  withDatabase(path, (db) => ({
    events: (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n,
    tasks: (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n,
  }));

let tmp: TempDatabase;
const running: ServerHandle[] = [];

async function start(path: string = tmp.path, env?: Record<string, string>): Promise<ServerHandle> {
  const handle = await startServer({ databasePath: path, ...(env ? { env } : {}) });
  running.push(handle);
  return handle;
}

beforeEach(() => {
  tmp = makeTempDatabase();
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.stop()));
  tmp.cleanup();
});

describe('data survives an application restart', () => {
  it('serves identical events and tasks after a clean stop and restart on the same database file', async () => {
    // First run: initialize and seed, read through MCP.
    const first = await start();
    expect(first.logs()).toContain('Database seeding: inserted 6 events, 5 tasks');
    const before = await readEverything(first);
    expect(before.eventCount).toBe(6);
    expect(before.taskCount).toBe(5);

    // Stop gracefully.
    const exit = await first.stop();
    expect(exit).toEqual({ code: 0, signal: null });
    expect(first.logs()).toContain('Database closed');

    // The file is on disk and contains the data, independent of any server process.
    expect(rowCounts(tmp.path)).toEqual({ events: 6, tasks: 5 });

    // Second run on the same path: nothing is seeded again, and MCP returns the same data.
    const second = await start();
    expect(second.logs()).toContain('Database seeding: inserted 0 events, 0 tasks');
    expect(second.logs()).toContain('(schema v1, 6 events, 5 tasks)');
    const after = await readEverything(second, LEGACY); // also cross-checks the other protocol era
    expect(after.eventCount).toBe(6);
    expect(after.taskCount).toBe(5);
    expect(after.events).toEqual(before.events);
    expect(after.tasks).toEqual(before.tasks);

    // Seeded rows were not duplicated.
    expect(new Set((after.tasks as Array<{ id: string }>).map((t) => t.id)).size).toBe(5);
    expect(new Set((after.events as Array<{ id: string }>).map((e) => e.id)).size).toBe(6);
  });

  it('does not grow the database across many restarts', async () => {
    for (let i = 0; i < 4; i++) {
      const server = await start();
      const snapshot = await readEverything(server);
      expect([snapshot.eventCount, snapshot.taskCount]).toEqual([6, 5]);
      expect((await server.stop()).code).toBe(0);
    }
    expect(rowCounts(tmp.path)).toEqual({ events: 6, tasks: 5 });
  });

  it('keeps changes made to the data and does not overwrite them with seed values on restart', async () => {
    const first = await start();
    expect((await callTasks(first, { status: 'pending' })).tasks.map((t) => t.id)).toEqual(['task-002', 'task-003', 'task-005']);
    await first.stop();

    // There is no write tool yet (Phase 2 is read-only), so edit the file the way a later phase's writes would.
    withDatabase(tmp.path, (db) => {
      db.prepare("UPDATE tasks SET status = 'completed', title = 'Prepare for project review (done)' WHERE id = 'task-002'").run();
      db.prepare("UPDATE calendar_events SET title = 'Team Meeting (moved)' WHERE id = 'evt-001'").run();
    });

    const second = await start();
    expect(second.logs()).toContain('Database seeding: inserted 0 events, 0 tasks');
    const pending = await callTasks(second, { status: 'pending' });
    expect(pending.tasks.map((t) => t.id)).toEqual(['task-003', 'task-005']);
    const completed = await callTasks(second, { status: 'completed' });
    expect(completed.tasks.map((t) => t.title)).toEqual(['Draft team meeting agenda', 'Prepare for project review (done)']);

    const snapshot = await readEverything(second);
    expect((snapshot.events as Array<{ id: string; title: string }>).find((e) => e.id === 'evt-001')?.title).toBe('Team Meeting (moved)');
  });

  it('reads live from SQLite: a change made to the file while the server runs shows up in the next call', async () => {
    const server = await start();
    expect((await callTasks(server, { status: 'pending' })).count).toBe(3);
    withDatabase(tmp.path, (db) => db.prepare("UPDATE tasks SET status = 'completed' WHERE id = 'task-005'").run());
    expect((await callTasks(server, { status: 'pending' })).tasks.map((t) => t.id)).toEqual(['task-002', 'task-003']);
    withDatabase(tmp.path, (db) =>
      db
        .prepare(
          "INSERT INTO tasks (id, title, estimated_duration_minutes, deadline, deadline_ms, priority, status, created_at, updated_at) VALUES ('live-1', 'Added while running', 25, '2026-10-22T19:00:00+05:30', ?, 'high', 'pending', 'x', 'x')",
        )
        .run(Date.parse('2026-10-22T19:00:00+05:30')),
    );
    const all = await callTasks(server, {});
    expect(all.count).toBe(6);
    expect(all.tasks.map((t) => t.id)).toContain('live-1');
    // Nothing is cached or hardcoded in the handler, and restart keeps the added row.
    await server.stop();
    const restarted = await start();
    expect((await callTasks(restarted, {})).count).toBe(6);
  });

  it('gives each database file its own isolated scenario', async () => {
    const other = makeTempDatabase();
    try {
      const a = await start(tmp.path);
      const b = await start(other.path);
      await a.stop();
      withDatabase(tmp.path, (db) => db.prepare('DELETE FROM tasks').run());
      const aAgain = await start(tmp.path);
      // Seeding is insert-if-absent, so deleted seed rows return; the other database is unaffected throughout.
      expect((await callTasks(b, {})).count).toBe(5);
      expect((await callTasks(aAgain, {})).count).toBe(5);
      expect(rowCounts(other.path)).toEqual({ events: 6, tasks: 5 });
    } finally {
      await Promise.all(running.splice(0).map((s) => s.stop()));
      other.cleanup();
    }
  });
});

describe('startup failures are explicit and never fall back to in-memory data', () => {
  it('exits with an error when DATABASE_PATH points at a directory', async () => {
    mkdirSync(tmp.path, { recursive: true }); // a directory where the file should be
    const error = await startServer({ databasePath: tmp.path }).then(
      (handle) => {
        running.push(handle);
        return undefined;
      },
      (e: unknown) => e,
    );
    expect(error, 'server must refuse to start').toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/exited early with code 1/);
    expect(message).toMatch(/Failed to initialize the database/);
    expect(message).toMatch(/is a directory/);
    expect(message).not.toMatch(/Endpoint:|Tool registered/);
  });

  it('exits with a configuration error for an in-memory DATABASE_PATH', async () => {
    const error = await startServer({ databasePath: ':memory:' }).then(
      (handle) => {
        running.push(handle);
        return undefined;
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/exited early with code 1/);
    expect((error as Error).message).toMatch(/DATABASE_PATH/);
  });
});
