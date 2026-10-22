import { describe, expect, it } from 'vitest';
import { clockTime, isoAtOffsetOf, isoWithOffset, offsetMinutesOf, toEpochMs } from '../apps/mcp-server/src/lib/time.js';

describe('offset-preserving timestamp helpers', () => {
  it.each([
    ['2026-10-22T12:30:00+05:30', 0, '2026-10-22T12:30:00+05:30'],
    ['2026-10-22T12:30:00+05:30', 40, '2026-10-22T13:10:00+05:30'],
    ['2026-10-22T23:30:00+05:30', 60, '2026-10-23T00:30:00+05:30'], // crosses midnight in local time
    ['2026-10-22T12:30:00Z', 90, '2026-10-22T14:00:00Z'],
    ['2026-10-22T12:30:00-08:00', 45, '2026-10-22T13:15:00-08:00'],
    ['2026-10-22T12:30:00+00:00', 5, '2026-10-22T12:35:00+00:00'],
  ])('shifts %s by %i minutes keeping its own offset -> %s', (reference, minutes, expected) => {
    const out = isoAtOffsetOf(reference, toEpochMs(reference) + minutes * 60_000);
    expect(out).toBe(expected);
    expect(isoWithOffset.safeParse(out).success).toBe(true);
    expect(toEpochMs(out)).toBe(toEpochMs(reference) + minutes * 60_000);
  });

  it('keeps fractional seconds only when present', () => {
    expect(isoAtOffsetOf('2026-10-22T12:30:00+05:30', toEpochMs('2026-10-22T12:30:00+05:30') + 500)).toBe('2026-10-22T12:30:00.500+05:30');
  });

  it('parses offsets and rejects offset-less input', () => {
    expect(offsetMinutesOf('2026-10-22T00:00:00Z')).toBe(0);
    expect(offsetMinutesOf('2026-10-22T00:00:00+05:30')).toBe(330);
    expect(offsetMinutesOf('2026-10-22T00:00:00-09:30')).toBe(-570);
    expect(() => offsetMinutesOf('2026-10-22T00:00:00')).toThrow(RangeError);
  });

  it('extracts the local wall-clock time', () => {
    expect(clockTime('2026-10-22T13:10:00+05:30')).toBe('13:10');
  });
});
