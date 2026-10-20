import { describe, expect, it } from 'vitest';
import { durationMinutes, isoWithOffset, overlaps, toEpochMs, validateRange } from '../apps/mcp-server/src/lib/time.js';

describe('isoWithOffset', () => {
  it.each([
    '2026-10-22T12:00:00+05:30',
    '2026-10-22T06:30:00Z',
    '2026-10-22T01:30:00-05:00',
    '2026-10-22T12:00:00.250+05:30',
    '2028-02-29T00:00:00+00:00', // leap day
  ])('accepts %s', (value) => {
    expect(isoWithOffset.safeParse(value).success).toBe(true);
  });

  it.each([
    ['no offset', '2026-10-22T12:00:00'],
    ['date only', '2026-10-22'],
    ['free text', 'tomorrow'],
    ['empty string', ''],
    ['compact offset without colon', '2026-10-22T12:00:00+0530'],
    ['space instead of T', '2026-10-22 12:00:00+05:30'],
    ['impossible day (Feb 30)', '2026-02-30T12:00:00+05:30'],
    ['non-leap Feb 29', '2026-02-29T12:00:00+05:30'],
    ['month 13', '2026-13-01T12:00:00+05:30'],
    ['hour 25', '2026-10-22T25:00:00+05:30'],
    ['oversized input', `2026-10-22T12:00:00+05:30${' '.repeat(100)}`],
  ])('rejects %s', (_label, value) => {
    expect(isoWithOffset.safeParse(value).success).toBe(false);
  });

  it('reports a single clear message for a malformed value', () => {
    const result = isoWithOffset.safeParse('tomorrow');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.message).toContain('explicit UTC offset');
    }
  });

  it('rejects non-string values', () => {
    expect(isoWithOffset.safeParse(5).success).toBe(false);
    expect(isoWithOffset.safeParse(null).success).toBe(false);
    expect(isoWithOffset.safeParse(undefined).success).toBe(false);
  });
});

describe('toEpochMs', () => {
  it('treats equivalent instants in different offsets as equal', () => {
    const ist = toEpochMs('2026-10-22T12:00:00+05:30');
    expect(toEpochMs('2026-10-22T06:30:00Z')).toBe(ist);
    expect(toEpochMs('2026-10-22T01:30:00-05:00')).toBe(ist);
  });

  it('throws on an unparseable value', () => {
    expect(() => toEpochMs('nope')).toThrow(RangeError);
  });
});

describe('overlaps (half-open intervals)', () => {
  const q = { start: 100, end: 200 };
  it.each([
    ['fully inside', 120, 180, true],
    ['starts before, ends inside', 50, 150, true],
    ['starts inside, ends after', 150, 250, true],
    ['fully contains the query', 50, 250, true],
    ['identical to the query', 100, 200, true],
    ['ends exactly when the query starts', 50, 100, false],
    ['starts exactly when the query ends', 200, 250, false],
    ['entirely before', 10, 50, false],
    ['entirely after', 300, 400, false],
  ])('%s', (_label, start, end, expected) => {
    expect(overlaps(start, end, q.start, q.end)).toBe(expected);
  });
});

describe('durationMinutes', () => {
  it('computes whole minutes across offsets', () => {
    expect(durationMinutes('2026-10-22T12:30:00+05:30', '2026-10-22T13:15:00+05:30')).toBe(45);
    expect(durationMinutes('2026-10-22T07:00:00Z', '2026-10-22T13:00:00+05:30')).toBe(30);
  });
});

describe('validateRange', () => {
  it('accepts a forward range', () => {
    expect(validateRange({ startMs: 1, endMs: 2 })).toBeUndefined();
  });
  it('rejects a reversed range', () => {
    expect(validateRange({ startMs: 2, endMs: 1 })).toMatch(/after startTime/);
  });
  it('rejects a zero-length range', () => {
    expect(validateRange({ startMs: 2, endMs: 2 })).toMatch(/after startTime/);
  });
});
