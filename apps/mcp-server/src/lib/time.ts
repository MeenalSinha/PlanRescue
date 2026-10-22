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

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;

/** UTC offset, in minutes, of a timestamp already validated by {@link isoWithOffset}. "Z" is 0. */
export function offsetMinutesOf(iso: string): number {
  const match = OFFSET_SUFFIX.exec(iso);
  if (!match) {
    throw new RangeError(`Timestamp has no explicit UTC offset: ${iso}`);
  }
  const suffix = match[1]!;
  if (suffix === 'Z') return 0;
  const sign = suffix.startsWith('-') ? -1 : 1;
  return sign * (Number(suffix.slice(1, 3)) * 60 + Number(suffix.slice(4, 6)));
}

/**
 * Format an instant (epoch milliseconds) as ISO 8601 using the same UTC offset as `referenceIso`,
 * so a derived time keeps the local-time semantics of the event it came from: shifting
 * 2026-10-22T12:30:00+05:30 by 40 minutes yields 2026-10-22T13:10:00+05:30, never a UTC rewrite.
 * Fractional seconds appear only when the instant has them.
 */
export function isoAtOffsetOf(referenceIso: string, epochMs: number): string {
  const offset = offsetMinutesOf(referenceIso);
  const local = new Date(epochMs + offset * 60_000).toISOString(); // fields are the local wall-clock time
  const wallClock = local.endsWith('.000Z') ? local.slice(0, 19) : local.slice(0, 23);
  if (offset === 0) return `${wallClock}${referenceIso.endsWith('Z') ? 'Z' : '+00:00'}`;
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wallClock}${offset < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** "HH:mm" wall-clock time of a timestamp, in its own offset. For human-readable explanations. */
export function clockTime(iso: string): string {
  return iso.slice(11, 16);
}
