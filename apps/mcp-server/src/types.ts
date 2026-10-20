import * as z from 'zod/v4';

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const CATEGORIES = ['meeting', 'focus', 'medical', 'deadline_work', 'personal'] as const;

/**
 * Calendar event as stored by a schedule repository.
 * Timestamps are ISO 8601 with an explicit UTC offset.
 */
export const scheduleEventSchema = z.object({
  id: z.string().describe('Stable event identifier'),
  title: z.string().describe('Human-readable event title'),
  startTime: z.string().describe('ISO 8601 start timestamp with explicit UTC offset'),
  endTime: z.string().describe('ISO 8601 end timestamp with explicit UTC offset'),
  priority: z.enum(PRIORITIES).describe('Importance of the event; critical events must not be sacrificed'),
  movable: z.boolean().describe('Whether the event may be rescheduled'),
  category: z.enum(CATEGORIES).describe('Kind of event'),
  notes: z.string().optional().describe('Optional context, such as a deadline attached to a work block'),
});
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

/** Event as returned by the get_schedule tool: stored fields plus a derived duration. */
export const scheduleEventResultSchema = scheduleEventSchema.extend({
  durationMinutes: z.number().int().positive().describe('Length of the event in whole minutes'),
});
export type ScheduleEventResult = z.infer<typeof scheduleEventResultSchema>;

/** A validated, half-open query interval [startMs, endMs) expressed in epoch milliseconds. */
export interface TimeRange {
  startMs: number;
  endMs: number;
}

/**
 * Data-access seam for calendar events. The Phase 1 implementation reads seeded
 * data; a later phase can supply a database-backed implementation without any
 * change to the MCP server or the tool.
 */
export interface ScheduleRepository {
  /** Events overlapping the range, in chronological order. */
  findOverlapping(range: TimeRange): Promise<ScheduleEvent[]>;
}
