/**
 * Time helpers shared by the browser and the route handlers.
 *
 * Calendar timestamps are ISO 8601 with an explicit UTC offset (for example 2026-10-22T11:30:00+05:30).
 * They are DISPLAYED from their own wall-clock text, so an event is always shown in the offset it was
 * stored with, whatever the viewer's browser time zone is. Date arithmetic is used only to measure a
 * difference between two instants, never to re-zone a value.
 */

export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoWithOffset(value: string): boolean {
  return ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value));
}

/** "+05:30" of a timestamp ("Z" becomes "+00:00"). */
export function offsetOf(iso: string): string {
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return '';
  return m[1] === 'Z' ? '+00:00' : m[1]!;
}

/** Calendar date part, "2026-10-22". */
export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** 24-hour wall-clock time, "13:30". */
export function clock24(iso: string): string {
  return iso.slice(11, 16);
}

/** 12-hour wall-clock time, "1:30 PM". */
export function clock(iso: string): string {
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu 22 Oct 2026" for a YYYY-MM-DD date. */
export function longDate(date: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
  return `${weekday} ${d} ${MONTHS[mo - 1]} ${y}`;
}

/** "22 Oct, 1:30 PM" style label for a timestamp, from its own wall clock. */
export function dateTimeLabel(iso: string): string {
  const [, mo, d] = dateOf(iso).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[mo - 1]}, ${clock(iso)}`;
}

/** "1:30 PM – 2:30 PM" (adds dates only when the range crosses midnight). */
export function rangeLabel(startIso: string, endIso: string): string {
  const crosses = dateOf(startIso) !== dateOf(endIso);
  return crosses ? `${dateTimeLabel(startIso)} – ${dateTimeLabel(endIso)}` : `${clock(startIso)} – ${clock(endIso)}`;
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
}

export function formatMinutes(total: number): string {
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const text = h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  return total < 0 ? `-${text}` : text;
}

/** Human description of how far a start time moved, e.g. "70 min later". */
export function describeMove(originalStart: string, proposedStart: string): string {
  const delta = minutesBetween(originalStart, proposedStart);
  if (delta === 0) return 'Start time unchanged';
  return `${formatMinutes(Math.abs(delta))} ${delta > 0 ? 'later' : 'earlier'}`;
}

/** UTC offset ("+05:30") that an IANA zone has at the middle of a calendar date. */
export function offsetForZone(date: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const noonUtc = new Date(Date.UTC(y, mo - 1, d, 12));
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(noonUtc)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-]\d{2}:\d{2})?$/.exec(part ?? '');
  return m?.[1] ?? '+00:00';
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, mo, d] = value.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Local day [00:00, next 00:00) of a calendar date in a zone, as offset-qualified timestamps. */
export function dayWindow(date: string, timeZone: string): { startTime: string; endTime: string } {
  const next = addDays(date, 1);
  return {
    startTime: `${date}T00:00:00${offsetForZone(date, timeZone)}`,
    endTime: `${next}T00:00:00${offsetForZone(next, timeZone)}`,
  };
}

/** "2026-10-22T08:00" (a datetime-local value) plus an offset, as an ISO timestamp with seconds. */
export function withOffset(localDateTime: string, offset: string): string {
  const base = localDateTime.length === 16 ? `${localDateTime}:00` : localDateTime;
  return `${base}${offset}`;
}

/** datetime-local value ("2026-10-22T08:00") of a timestamp's own wall clock. */
export function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

/** Wall-clock "HH:MM" of an instant as seen in a fixed UTC offset such as "+05:30". */
export function wallClockAt(epochMs: number, offset: string): string {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number) as [number, number];
  return new Date(epochMs + sign * (h * 60 + m) * 60_000).toISOString().slice(11, 16);
}
