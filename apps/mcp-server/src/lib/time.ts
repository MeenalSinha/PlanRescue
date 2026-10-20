import * as z from 'zod/v4';
import type { TimeRange } from '../types.js';

/**
 * ISO 8601 timestamp that MUST carry an explicit UTC offset ("Z" or "+HH:MM").
 * Local timestamps without an offset are rejected because they are ambiguous.
 */
const isoShape = z.iso.datetime({
  offset: true,
  message: 'Must be an ISO 8601 timestamp with an explicit UTC offset, e.g. 2026-10-22T12:00:00+05:30',
});

export const isoWithOffset = isoShape
  .max(64)
  // Belt and braces: the format check above is calendar-aware, this guarantees the runtime can parse it.
  // It stays silent when the format check already failed so the caller sees a single, clear message.
  .refine((value) => !isoShape.safeParse(value).success || !Number.isNaN(Date.parse(value)), {
    message: 'Not a real calendar date and time',
  });

/** Parse a timestamp already validated by {@link isoWithOffset} into epoch milliseconds. */
export function toEpochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid timestamp: ${iso}`);
  }
  return ms;
}

/**
 * Overlap rule shared by every caller: two half-open intervals [aStart, aEnd) and
 * [bStart, bEnd) overlap when each starts before the other ends. An event that ends
 * exactly when the query begins (or starts exactly when it ends) does NOT overlap.
 */
export function overlaps(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((toEpochMs(endIso) - toEpochMs(startIso)) / 60_000);
}

/** Returns an error message when the range is invalid, otherwise undefined. */
export function validateRange(range: TimeRange): string | undefined {
  if (range.endMs <= range.startMs) {
    return 'endTime must be strictly after startTime';
  }
  return undefined;
}
