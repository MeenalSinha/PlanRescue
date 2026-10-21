import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedTasks } from '../apps/mcp-server/src/data/seedTasks.js';
import { SqliteTaskRepository } from '../apps/mcp-server/src/data/sqliteTaskRepository.js';
import { initializeDatabase, type Db } from '../apps/mcp-server/src/db/database.js';
import { InvalidQueryError } from '../apps/mcp-server/src/lib/errors.js';
import { toEpochMs } from '../apps/mcp-server/src/lib/time.js';
import { taskSchema, type TaskQuery, type TaskStatus } from '../apps/mcp-server/src/types.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

const ms = (iso: string): number => toEpochMs(iso);
const DAY_START = ms('2026-10-22T00:00:00+05:30');
const DAY_END = ms('2026-10-23T00:00:00+05:30');

let tmp: TempDatabase;
let db: Db;
let repo: SqliteTaskRepository;

beforeEach(() => {
  tmp = makeTempDatabase();
  db = initializeDatabase(tmp.path).db;
  repo = new SqliteTaskRepository(db);
});
afterEach(() => {
  if (db.open) db.close();
  tmp.cleanup();
});

const ids = async (query?: TaskQuery): Promise<string[]> => (await repo.findTasks(query)).map((t) => t.id);

function insertTask(id: string, deadline: string, priority: string, over: { description?: string | null; status?: string } = {}): void {
  db.prepare(
    'INSERT INTO tasks (id, title, description, estimated_duration_minutes, deadline, deadline_ms, priority, status, created_at, updated_at) VALUES (?, ?, ?, 15, ?, ?, ?, ?, ?, ?)',
  ).run(id, id, over.description ?? null, deadline, ms(deadline), priority, over.status ?? 'pending', '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z');
}

describe('retrieving tasks', () => {
  it('returns every seeded task when no filter is given, with and without an argument', async () => {
    expect(await ids()).toEqual(['task-004', 'task-002', 'task-003', 'task-001', 'task-005']);
    expect(await ids({})).toEqual(['task-004', 'task-002', 'task-003', 'task-001', 'task-005']);
  });

  it('exposes every required field, and each record satisfies the shared schema', async () => {
    const tasks = await repo.findTasks();
    expect(tasks).toHaveLength(seedTasks.length);
    for (const task of tasks) {
      expect(Object.keys(task).sort()).toEqual(
        ['createdAt', 'deadline', 'description', 'estimatedDurationMinutes', 'id', 'priority', 'status', 'title', 'updatedAt'].sort(),
      );
      expect(taskSchema.safeParse(task).success).toBe(true);
      expect(Number.isInteger(task.estimatedDurationMinutes) && task.estimatedDurationMinutes > 0).toBe(true);
    }
    expect(tasks.find((t) => t.id === 'task-001')).toEqual(seedTasks.find((t) => t.id === 'task-001'));
  });

  it('keeps each deadline as the original offset-bearing text', async () => {
    const task = (await repo.findTasks()).find((t) => t.id === 'task-001')!;
    expect(task.deadline).toBe('2026-10-22T20:00:00+05:30');
  });

  it('omits description when it is NULL instead of returning null', async () => {
    insertTask('no-desc', '2026-10-24T10:00:00+05:30', 'low');
    const task = (await repo.findTasks()).find((t) => t.id === 'no-desc')!;
    expect('description' in task).toBe(false);
  });
});

describe('ordering', () => {
  it('orders by deadline instant first', async () => {
    const deadlines = (await repo.findTasks()).map((t) => ms(t.deadline));
    expect(deadlines).toEqual([...deadlines].sort((a, b) => a - b));
  });

  it('breaks deadline ties by priority (critical first) and then by id', async () => {
    const same = '2026-10-22T22:00:00+05:30';
    insertTask('t-low', same, 'low');
    insertTask('t-crit-b', same, 'critical');
    insertTask('t-crit-a', same, 'critical');
    insertTask('t-high', same, 'high');
    insertTask('t-med', same, 'medium');
    const got = await ids({ deadlineFromMs: ms(same), deadlineToMs: ms(same) + 1 });
    expect(got).toEqual(['t-crit-a', 't-crit-b', 't-high', 't-med', 't-low']);
  });

  it('compares deadlines as instants even when written in different UTC offsets', async () => {
    insertTask('utc-dl', '2026-10-22T07:00:00Z', 'low'); // 12:30 IST, between task-004 (11:30) and task-002 (13:30)
    expect(await ids({ deadlineFromMs: DAY_START, deadlineToMs: DAY_END })).toEqual([
      'task-004',
      'utc-dl',
      'task-002',
      'task-003',
      'task-001',
    ]);
  });

  it('returns the same order on every call', async () => {
    const first = await ids();
    for (let i = 0; i < 5; i++) expect(await ids()).toEqual(first);
  });
});

describe('deadline filters', () => {
  it('returns only tasks due on 22 October for that day window', async () => {
    expect(await ids({ deadlineFromMs: DAY_START, deadlineToMs: DAY_END })).toEqual(['task-004', 'task-002', 'task-003', 'task-001']);
  });

  it('treats the lower bound as inclusive and the upper bound as exclusive', async () => {
    const due = ms('2026-10-22T13:30:00+05:30'); // task-002
    expect(await ids({ deadlineFromMs: due, deadlineToMs: due + 60_000 })).toEqual(['task-002']);
    expect(await ids({ deadlineFromMs: due - 60_000, deadlineToMs: due })).toEqual([]);
    expect(await ids({ deadlineFromMs: due + 1, deadlineToMs: due + 60_000 })).toEqual([]);
  });

  it('supports a lower bound alone and an upper bound alone', async () => {
    expect(await ids({ deadlineFromMs: ms('2026-10-22T18:00:00+05:30') })).toEqual(['task-003', 'task-001', 'task-005']);
    expect(await ids({ deadlineToMs: ms('2026-10-22T18:00:00+05:30') })).toEqual(['task-004', 'task-002']);
  });

  it('gives identical results for equivalent instants in other offsets', async () => {
    const ist = await ids({ deadlineFromMs: ms('2026-10-22T12:00:00+05:30'), deadlineToMs: ms('2026-10-22T19:00:00+05:30') });
    const utc = await ids({ deadlineFromMs: ms('2026-10-22T06:30:00Z'), deadlineToMs: ms('2026-10-22T13:30:00Z') });
    const us = await ids({ deadlineFromMs: ms('2026-10-22T01:30:00-05:00'), deadlineToMs: ms('2026-10-22T08:30:00-05:00') });
    expect(ist).toEqual(['task-002', 'task-003']);
    expect(utc).toEqual(ist);
    expect(us).toEqual(ist);
  });
});

describe('status filter', () => {
  it.each([
    ['pending', ['task-002', 'task-003', 'task-005']],
    ['in_progress', ['task-001']],
    ['completed', ['task-004']],
  ] as [TaskStatus, string[]][])('returns only %s tasks', async (status, expected) => {
    expect(await ids({ status })).toEqual(expected);
  });

  it('reflects a status change made in the database', async () => {
    db.prepare("UPDATE tasks SET status = 'completed' WHERE id = 'task-002'").run();
    expect(await ids({ status: 'pending' })).toEqual(['task-003', 'task-005']);
    expect(await ids({ status: 'completed' })).toEqual(['task-004', 'task-002']);
  });
});

describe('combined filters', () => {
  it('applies status and the deadline window together', async () => {
    expect(await ids({ status: 'pending', deadlineFromMs: DAY_START, deadlineToMs: DAY_END })).toEqual(['task-002', 'task-003']);
    expect(await ids({ status: 'pending', deadlineFromMs: DAY_END })).toEqual(['task-005']);
    expect(await ids({ status: 'in_progress', deadlineToMs: ms('2026-10-22T18:00:00+05:30') })).toEqual([]);
  });
});

describe('empty results', () => {
  it('are valid, not errors', async () => {
    expect(await repo.findTasks({ deadlineFromMs: ms('2027-01-01T00:00:00Z') })).toEqual([]);
    expect(await repo.findTasks({ status: 'in_progress', deadlineFromMs: DAY_END })).toEqual([]);
    db.prepare('DELETE FROM tasks').run();
    expect(await repo.findTasks()).toEqual([]);
  });
});

describe('invalid input and database errors', () => {
  it('rejects an unknown status', async () => {
    await expect(repo.findTasks({ status: 'done' as TaskStatus })).rejects.toBeInstanceOf(InvalidQueryError);
    await expect(repo.findTasks({ status: 'done' as TaskStatus })).rejects.toThrow(/pending, in_progress, completed/);
  });

  it.each([
    ['inverted window', { deadlineFromMs: 2000, deadlineToMs: 1000 }],
    ['empty window', { deadlineFromMs: 1000, deadlineToMs: 1000 }],
    ['NaN lower bound', { deadlineFromMs: Number.NaN }],
    ['infinite upper bound', { deadlineToMs: Number.POSITIVE_INFINITY }],
  ] as [string, TaskQuery][])('rejects an %s before querying', async (_label, query) => {
    db.close(); // a query attempt would produce a database error, not InvalidQueryError
    await expect(repo.findTasks(query)).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it('does not treat injection-looking input as SQL', async () => {
    await expect(repo.findTasks({ status: "pending' OR '1'='1" as TaskStatus })).rejects.toBeInstanceOf(InvalidQueryError);
    insertTask('inj', '2026-10-24T10:00:00+05:30', 'low');
    db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run("'; DROP TABLE tasks;--", 'inj');
    expect((await repo.findTasks()).map((t) => t.id)).toContain('inj');
  });

  it('propagates a database failure as a distinct error rather than an empty result', async () => {
    db.close();
    const failure = await repo.findTasks().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InvalidQueryError);
  });
});
