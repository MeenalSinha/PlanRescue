import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeedScheduleRepository, seedEvents } from '../apps/mcp-server/src/data/seedSchedule.js';
import { SqliteScheduleRepository } from '../apps/mcp-server/src/data/sqliteScheduleRepository.js';
import { initializeDatabase, type Db } from '../apps/mcp-server/src/db/database.js';
import { InvalidQueryError } from '../apps/mcp-server/src/lib/errors.js';
import { toEpochMs } from '../apps/mcp-server/src/lib/time.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

const ms = (iso: string): number => toEpochMs(iso);
const range = (a: string, b: string) => ({ startMs: ms(a), endMs: ms(b) });
const DAY = range('2026-10-22T00:00:00+05:30', '2026-10-23T00:00:00+05:30');

let tmp: TempDatabase;
let db: Db;
let repo: SqliteScheduleRepository;

beforeEach(() => {
  tmp = makeTempDatabase();
  db = initializeDatabase(tmp.path).db;
  repo = new SqliteScheduleRepository(db);
});
afterEach(() => {
  if (db.open) db.close();
  tmp.cleanup();
});

function insertEvent(id: string, start: string, end: string, extra: { title?: string; notes?: string | null } = {}): void {
  db.prepare(
    "INSERT INTO calendar_events (id, title, start_time, end_time, start_ms, end_ms, priority, movable, category, notes) VALUES (?, ?, ?, ?, ?, ?, 'low', 1, 'personal', ?)",
  ).run(id, extra.title ?? id, start, end, ms(start), ms(end), extra.notes ?? null);
}

describe('SqliteScheduleRepository.findOverlapping', () => {
  it('returns the seeded events from SQLite, in chronological order, in the established shape', async () => {
    const found = await repo.findOverlapping(DAY);
    expect(found.map((e) => e.id)).toEqual(['evt-001', 'evt-002', 'evt-003', 'evt-004', 'evt-005', 'evt-006']);
    expect(found).toEqual(seedEvents.map((e) => ({ ...e })));
  });

  it('omits notes when an event has none, rather than returning null', async () => {
    const [, lunch] = await repo.findOverlapping(DAY);
    expect(lunch!.title).toBe('Lunch Break');
    expect('notes' in lunch!).toBe(false);
    expect(typeof lunch!.movable).toBe('boolean');
  });

  it('orders by start instant regardless of id or insertion order', async () => {
    insertEvent('zzz-early', '2026-10-22T08:00:00+05:30', '2026-10-22T09:00:00+05:30');
    insertEvent('aaa-late', '2026-10-22T21:00:00+05:30', '2026-10-22T22:00:00+05:30');
    const ids = (await repo.findOverlapping(DAY)).map((e) => e.id);
    expect(ids[0]).toBe('zzz-early');
    expect(ids[ids.length - 1]).toBe('aaa-late');
  });

  it('orders by instant, not by the text, when events use different UTC offsets', async () => {
    // 07:00Z is 12:30 IST. As text "2026-10-22T07:00:00Z" sorts after "2026-10-22T05:00:00-08:00"? Instants decide.
    insertEvent('utc-evt', '2026-10-22T08:00:00Z', '2026-10-22T08:30:00Z'); // 13:30 IST
    insertEvent('pst-evt', '2026-10-21T22:30:00-08:00', '2026-10-21T23:00:00-08:00'); // 12:00Z+... = 2026-10-22T06:30Z = 12:00 IST
    const ids = (await repo.findOverlapping(range('2026-10-22T12:00:00+05:30', '2026-10-22T14:00:00+05:30'))).map((e) => e.id);
    expect(ids).toEqual(['evt-001', 'pst-evt', 'evt-002', 'utc-evt', 'evt-003']);
  });

  it('breaks start ties by end time, then id', async () => {
    insertEvent('b-tie', '2026-10-22T07:00:00+05:30', '2026-10-22T07:30:00+05:30');
    insertEvent('a-tie', '2026-10-22T07:00:00+05:30', '2026-10-22T07:30:00+05:30');
    insertEvent('c-short', '2026-10-22T07:00:00+05:30', '2026-10-22T07:15:00+05:30');
    const ids = (await repo.findOverlapping(range('2026-10-22T07:00:00+05:30', '2026-10-22T08:00:00+05:30'))).map((e) => e.id);
    expect(ids).toEqual(['c-short', 'a-tie', 'b-tie']);
  });

  it('includes an event that starts before the query and runs into it', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T12:00:00+05:30', '2026-10-22T12:10:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(['Team Meeting']);
  });

  it('includes an event that starts inside the query and runs past its end', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T19:00:00+05:30', '2026-10-22T19:10:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(['Project Deadline Work']);
  });

  it('includes an event that fully contains the query', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T14:45:00+05:30', '2026-10-22T14:50:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(['Focus Work']);
  });

  it('excludes an event that ends exactly when the query starts', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T12:30:00+05:30', '2026-10-22T13:15:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(['Lunch Break']); // Team Meeting ends at 12:30
  });

  it('excludes an event that starts exactly when the query ends', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T17:00:00+05:30', '2026-10-22T18:00:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(["Doctor's Appointment"]); // Project Deadline Work starts at 18:00
  });

  it('treats a one-millisecond overlap as an overlap', async () => {
    const start = ms('2026-10-22T12:30:00+05:30') - 1;
    const found = await repo.findOverlapping({ startMs: start, endMs: start + 2 });
    expect(found.map((e) => e.id)).toEqual(['evt-001', 'evt-002']);
  });

  it('returns an empty list, not an error, for a gap, a different day, or an empty calendar', async () => {
    expect(await repo.findOverlapping(range('2026-10-22T13:15:00+05:30', '2026-10-22T13:30:00+05:30'))).toEqual([]);
    expect(await repo.findOverlapping(range('2026-10-23T00:00:00+05:30', '2026-10-24T00:00:00+05:30'))).toEqual([]);
    db.prepare('DELETE FROM calendar_events').run();
    expect(await repo.findOverlapping(DAY)).toEqual([]);
  });

  it('returns identical results for the same instants expressed in different UTC offsets', async () => {
    const ist = await repo.findOverlapping(range('2026-10-22T12:00:00+05:30', '2026-10-22T18:00:00+05:30'));
    const utc = await repo.findOverlapping(range('2026-10-22T06:30:00Z', '2026-10-22T12:30:00Z'));
    const us = await repo.findOverlapping(range('2026-10-22T01:30:00-05:00', '2026-10-22T07:30:00-05:00'));
    const jp = await repo.findOverlapping(range('2026-10-22T15:30:00+09:00', '2026-10-22T21:30:00+09:00'));
    expect(ist).toHaveLength(5);
    for (const other of [utc, us, jp]) expect(other).toEqual(ist);
  });

  it('keeps the stored offset text intact in what it returns', async () => {
    insertEvent('utc-evt', '2026-10-22T08:00:00Z', '2026-10-22T08:30:00Z');
    const found = await repo.findOverlapping(range('2026-10-22T08:00:00Z', '2026-10-22T08:30:00Z'));
    expect(found.find((e) => e.id === 'utc-evt')).toMatchObject({ startTime: '2026-10-22T08:00:00Z', endTime: '2026-10-22T08:30:00Z' });
  });

  it('is safe against SQL injection in stored text (parameters are bound, not concatenated)', async () => {
    insertEvent('inj', '2026-10-22T07:00:00+05:30', '2026-10-22T07:30:00+05:30', { title: "x'); DROP TABLE calendar_events;--" });
    const found = await repo.findOverlapping(range('2026-10-22T07:00:00+05:30', '2026-10-22T07:30:00+05:30'));
    expect(found[0]!.title).toBe("x'); DROP TABLE calendar_events;--");
    expect((await repo.findOverlapping(DAY)).length).toBe(seedEvents.length + 1);
  });

  it('agrees with the in-memory repository on many ranges (same overlap semantics)', async () => {
    const memory = new SeedScheduleRepository();
    const base = ms('2026-10-22T08:00:00+05:30');
    const quarter = 15 * 60_000;
    for (let i = 0; i < 48; i++) {
      for (const len of [1, 2, 4, 8]) {
        const r = { startMs: base + i * quarter, endMs: base + (i + len) * quarter };
        expect(await repo.findOverlapping(r), `range #${i} len ${len}`).toEqual(await memory.findOverlapping(r));
      }
    }
  });
});

describe('invalid ranges and database errors', () => {
  it.each([
    ['end before start', { startMs: 2000, endMs: 1000 }],
    ['end equal to start', { startMs: 1000, endMs: 1000 }],
    ['NaN start', { startMs: Number.NaN, endMs: 1000 }],
    ['infinite end', { startMs: 0, endMs: Number.POSITIVE_INFINITY }],
  ])('rejects %s before querying', async (_label, bad) => {
    db.close(); // if the repository tried to query it would fail with a database error instead
    await expect(repo.findOverlapping(bad)).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it('propagates a database failure as a distinct error rather than an empty result', async () => {
    db.close();
    const failure = await repo.findOverlapping(DAY).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InvalidQueryError);
  });
});
