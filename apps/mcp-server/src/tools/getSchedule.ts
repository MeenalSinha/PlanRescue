import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { SEED_TIME_ZONE } from '../data/seedSchedule.js';
import { durationMinutes, isoWithOffset, toEpochMs, validateRange } from '../lib/time.js';
import { describeIssues, withValidationReporting } from '../lib/validation.js';
import type { Logger } from '../logger.js';
import { scheduleEventResultSchema, type ScheduleEventResult, type ScheduleRepository } from '../types.js';

export const GET_SCHEDULE_TOOL = 'get_schedule';

export const getScheduleInputSchema = z.object({
  startTime: isoWithOffset.describe(
    'Start of the interval as an ISO 8601 timestamp with an explicit UTC offset, e.g. 2026-10-22T12:00:00+05:30',
  ),
  endTime: isoWithOffset.describe(
    'End of the interval as an ISO 8601 timestamp with an explicit UTC offset; must be after startTime',
  ),
});

export const getScheduleOutputSchema = z.object({
  calendarTimeZone: z.string().describe('IANA time zone the calendar data belongs to'),
  query: z.object({
    startTime: z.string().describe('Requested interval start, as supplied'),
    endTime: z.string().describe('Requested interval end, as supplied'),
  }),
  count: z.number().int().nonnegative().describe('Number of events overlapping the interval'),
  events: z.array(scheduleEventResultSchema).describe('Overlapping events in chronological order'),
});
export type GetScheduleOutput = z.infer<typeof getScheduleOutputSchema>;

export interface GetScheduleDeps {
  repository: ScheduleRepository;
  logger: Logger;
}

/** Readable summary returned alongside the structured result. */
export function formatScheduleText(output: GetScheduleOutput): string {
  const { query, count, events, calendarTimeZone } = output;
  if (count === 0) {
    return `No events between ${query.startTime} and ${query.endTime} (calendar time zone ${calendarTimeZone}).`;
  }
  const header = `${count} event${count === 1 ? '' : 's'} between ${query.startTime} and ${query.endTime} (calendar time zone ${calendarTimeZone}):`;
  const lines = events.map(
    (e, i) =>
      `${i + 1}. ${e.title} | ${e.startTime} to ${e.endTime} | ${e.durationMinutes} min | priority ${e.priority} | ${
        e.movable ? 'movable' : 'not movable'
      } | id ${e.id}`,
  );
  return [header, ...lines].join('\n');
}

/** Register the get_schedule tool on an MCP server. */
export function registerGetScheduleTool(server: McpServer, deps: GetScheduleDeps): string {
  const { repository, logger } = deps;

  server.registerTool(
    GET_SCHEDULE_TOOL,
    {
      title: 'Get schedule',
      description:
        "Retrieve the user's calendar events that overlap a time interval, in chronological order. " +
        'An event overlaps when it starts before endTime and ends after startTime, so an event that ends exactly at startTime is not included. ' +
        'Both timestamps must be ISO 8601 with an explicit UTC offset (for example 2026-10-22T12:00:00+05:30 or 2026-10-22T06:30:00Z).',
      inputSchema: withValidationReporting(getScheduleInputSchema, (issues) =>
        logger.warn(`Tool: ${GET_SCHEDULE_TOOL} | Status: rejected | Invalid input | ${describeIssues(issues)}`),
      ),
      outputSchema: getScheduleOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ startTime, endTime }) => {
      const started = performance.now();
      const range = { startMs: toEpochMs(startTime), endMs: toEpochMs(endTime) };
      logger.info(`Tool: ${GET_SCHEDULE_TOOL} | Requested interval: [${startTime}, ${endTime})`);

      const rangeError = validateRange(range);
      if (rangeError) {
        logger.warn(`Tool: ${GET_SCHEDULE_TOOL} | Status: rejected | Reason: ${rangeError}`);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Invalid time range: ${rangeError}.` }],
        };
      }

      try {
        const found = await repository.findOverlapping(range);
        const events: ScheduleEventResult[] = found.map((event) => ({
          ...event,
          durationMinutes: durationMinutes(event.startTime, event.endTime),
        }));
        const output: GetScheduleOutput = {
          calendarTimeZone: SEED_TIME_ZONE,
          query: { startTime, endTime },
          count: events.length,
          events,
        };
        logger.info(
          `Tool: ${GET_SCHEDULE_TOOL} | Matching events: ${events.length} | Status: success | ${(performance.now() - started).toFixed(1)}ms`,
        );
        return {
          content: [{ type: 'text' as const, text: formatScheduleText(output) }],
          structuredContent: output,
        };
      } catch (error) {
        logger.error(
          `Tool: ${GET_SCHEDULE_TOOL} | Status: failure | ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'The schedule could not be retrieved due to an internal error.' }],
        };
      }
    },
  );

  return GET_SCHEDULE_TOOL;
}
