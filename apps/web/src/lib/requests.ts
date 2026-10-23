/**
 * Request schemas for the application's API routes. The browser form validates with the SAME schemas
 * the route handlers enforce, so what the form accepts is exactly what the server accepts. The limits
 * mirror the Recovery Engine's published limits; the engine remains the authority and re-checks them.
 */
import * as z from 'zod';
import { isIsoWithOffset } from './time';

export const MAX_OVERRUN_MINUTES = 240;
export const MAX_PROTECTED_EVENT_IDS = 100;
export const MAX_PLANNING_WINDOW_DAYS = 14;
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_PLAN_BODY_BYTES = 256 * 1024;
export const OVERRUN_PRESETS = [15, 30, 40, 60] as const;
export const RANKING_PREFERENCES = ['minimal_disruption', 'transition_time'] as const;

const isoWithOffset = z
  .string()
  .max(64)
  .refine(isIsoWithOffset, { message: 'Use a date and time with an explicit UTC offset' });

const eventId = z.string().min(1).max(128);

export const disruptionInput = z.strictObject({
  type: z.literal('event_overrun'),
  eventId,
  overrunMinutes: z
    .number({ error: 'Enter the overrun as a whole number of minutes' })
    .int('Enter a whole number of minutes')
    .min(1, 'The overrun must be at least 1 minute')
    .max(MAX_OVERRUN_MINUTES, `The overrun can be at most ${MAX_OVERRUN_MINUTES} minutes`),
});

const scenarioShape = {
  startTime: isoWithOffset,
  endTime: isoWithOffset,
  disruption: disruptionInput,
  protectedEventIds: z.array(eventId).max(MAX_PROTECTED_EVENT_IDS).optional(),
};

function windowOrdering(value: { startTime: string; endTime: string }, ctx: z.RefinementCtx): void {
  const start = Date.parse(value.startTime);
  const end = Date.parse(value.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return;
  if (end <= start) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'The window must end after it starts' });
  } else if (end - start > MAX_PLANNING_WINDOW_DAYS * 86_400_000) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: `The window can be at most ${MAX_PLANNING_WINDOW_DAYS} days long` });
  }
}

export const analyzeRequestSchema = z.strictObject(scenarioShape).superRefine(windowOrdering);
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const proposeRequestSchema = z
  .strictObject({
    ...scenarioShape,
    preferences: z.strictObject({ optimizeFor: z.enum(RANKING_PREFERENCES).optional() }).optional(),
    saveCandidates: z.boolean().optional(),
  })
  .superRefine(windowOrdering);
export type ProposeRequest = z.infer<typeof proposeRequestSchema>;

/** A candidate exactly as propose_recovery_plan returned it. Unknown fields are allowed and preserved. */
export const validateRequestSchema = z.looseObject({
  planId: z.string().max(128).optional(),
  startTime: isoWithOffset,
  endTime: isoWithOffset,
  disruption: z.looseObject({ type: z.literal('event_overrun'), eventId, overrunMinutes: z.number().int().min(1).max(MAX_OVERRUN_MINUTES) }),
  changes: z.array(z.looseObject({ eventId })).max(200),
  protectedEventIds: z.array(eventId).max(MAX_PROTECTED_EVENT_IDS).optional(),
});

export const dashboardQuerySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Field-keyed messages from a failed parse, for forms and API error bodies. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
