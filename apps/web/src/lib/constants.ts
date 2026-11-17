import { todayInZone } from './time';

/**
 * Defaults taken from the seeded sample workday (see apps/mcp-server/src/data/seedSchedule.ts):
 * Thursday 22 October 2026, Asia/Kolkata, events between 11:30 and 20:00.
 */
export const SAMPLE_WORKDAY_DATE = '2026-10-22';

/**
 * Returns the default working date: in production mode, returns today's current date
 * in the requested timezone; in dev/test, uses the seeded sample workday date.
 */
export function getDefaultDate(timezone: string = 'Asia/Kolkata'): string {
  if (process.env.NODE_ENV === 'production') {
    return todayInZone(timezone);
  }
  return SAMPLE_WORKDAY_DATE;
}

export const DEFAULT_DATE = SAMPLE_WORKDAY_DATE;
export const DEFAULT_PLANNING_START = '08:00';
export const DEFAULT_PLANNING_END = '20:00';
/** Tasks due within this many days after the selected date are listed on the dashboard. */
export const TASK_LOOKAHEAD_DAYS = 7;
