import { describe, expect, it } from 'vitest';
import { SEED_TIME_ZONE, SeedScheduleRepository, seedEvents } from '../apps/mcp-server/src/data/seedSchedule.js';
import { toEpochMs } from '../apps/mcp-server/src/lib/time.js';
import { PRIORITIES, scheduleEventSchema } from '../apps/mcp-server/src/types.js';

const ms = (iso: string): number => toEpochMs(iso);
const range = (a: string, b: string) => ({ startMs: ms(a), endMs: ms(b) });

describe('seed data integrity', () => {
  it('uses the Asia/Kolkata calendar and 22 October 2026', () => {
    expect(SEED_TIME_ZONE).toBe('Asia/Kolkata');
    for (const e of seedEvents) {
      expect(e.startTime.startsWith('2026-10-22T')).toBe(true);
      expect(e.endTime.startsWith('2026-10-22T')).toBe(true);
    }
  });

  it('contains the five required events', () => {
    const titles = seedEvents.map((e) => e.title);
    for (const required of ['Team Meeting', 'Project Review', 'Focus Work', "Doctor's Appointment", 'Project Deadline Work']) {
      expect(titles).toContain(required);
    }
  });

  it('has unique ids and schema-valid records with explicit +05:30 offsets', () => {
    expect(new Set(seedEvents.map((e) => e.id)).size).toBe(seedEvents.length);
    for (const e of seedEvents) {
      expect(scheduleEventSchema.safeParse(e).success).toBe(true);
      expect(e.startTime).toMatch(/\+05:30$/);
      expect(e.endTime).toMatch(/\+05:30$/);
      expect(PRIORITIES).toContain(e.priority);
    }
  });

  it('is logically consistent: every event ends after it starts and no two events overlap', () => {
    const sorted = [...seedEvents].sort((a, b) => ms(a.startTime) - ms(b.startTime));
    for (const e of sorted) expect(ms(e.endTime)).toBeGreaterThan(ms(e.startTime));
    for (let i = 1; i < sorted.length; i++) {
      expect(ms(sorted[i]!.startTime)).toBeGreaterThanOrEqual(ms(sorted[i - 1]!.endTime));
    }
  });

  it('marks the doctor appointment as critical and immovable', () => {
    const doctor = seedEvents.find((e) => e.title === "Doctor's Appointment");
    expect(doctor).toMatchObject({ priority: 'critical', movable: false });
  });
});

describe('SeedScheduleRepository.findOverlapping', () => {
  const repo = new SeedScheduleRepository();

  it('returns events in chronological order regardless of storage order', async () => {
    const shuffled = [...seedEvents].reverse();
    const found = await new SeedScheduleRepository(shuffled).findOverlapping(
      range('2026-10-22T00:00:00+05:30', '2026-10-23T00:00:00+05:30'),
    );
    const starts = found.map((e) => ms(e.startTime));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(found).toHaveLength(seedEvents.length);
  });

  it('includes an event that starts before the query and runs into it', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T12:00:00+05:30', '2026-10-22T12:10:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(['Team Meeting']);
  });

  it('excludes an event that ends exactly when the query starts', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T12:30:00+05:30', '2026-10-22T13:15:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(['Lunch Break']);
  });

  it('excludes an event that starts exactly when the query ends', async () => {
    const found = await repo.findOverlapping(range('2026-10-22T17:00:00+05:30', '2026-10-22T18:00:00+05:30'));
    expect(found.map((e) => e.title)).toEqual(["Doctor's Appointment"]);
  });

  it('returns nothing for a gap between events', async () => {
    expect(await repo.findOverlapping(range('2026-10-22T13:15:00+05:30', '2026-10-22T13:30:00+05:30'))).toEqual([]);
  });

  it('returns nothing for a different day', async () => {
    expect(await repo.findOverlapping(range('2026-10-23T00:00:00+05:30', '2026-10-24T00:00:00+05:30'))).toEqual([]);
  });

  it('returns copies so callers cannot mutate the stored data', async () => {
    const [first] = await repo.findOverlapping(range('2026-10-22T00:00:00+05:30', '2026-10-23T00:00:00+05:30'));
    first!.title = 'Tampered';
    expect(seedEvents[0]!.title).toBe('Team Meeting');
  });
});
