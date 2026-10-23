/**
 * Zod validation schemas for AI agent requests, intent extraction and responses.
 */
import * as z from 'zod';
import { isIsoWithOffset } from '../time';
import { MAX_OVERRUN_MINUTES, MAX_PROTECTED_EVENT_IDS, RANKING_PREFERENCES } from '../requests';

const isoWithOffset = z
  .string()
  .max(64)
  .refine(isIsoWithOffset, { message: 'Use a date and time with an explicit UTC offset' });

export const agentChatMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters'),
});

export const agentTurnRequestSchema = z.strictObject({
  message: z.string().trim().min(1, 'Please enter a message').max(2000, 'Message cannot exceed 2000 characters'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted YYYY-MM-DD'),
  window: z.strictObject({ startTime: isoWithOffset, endTime: isoWithOffset }).optional(),
  history: z.array(agentChatMessageSchema).max(20, 'Conversation history cannot exceed 20 messages').optional(),
  saveCandidates: z.boolean().optional(),
});
export type AgentTurnRequest = z.infer<typeof agentTurnRequestSchema>;

export const rawExtractedIntentSchema = z.object({
  status: z.enum(['supported', 'needs_clarification', 'unsupported']),
  disruptionType: z.literal('event_overrun').optional(),
  targetEventId: z.string().nullable().optional(),
  targetEventTitle: z.string().nullable().optional(),
  overrunMinutes: z.number().int().nullable().optional(),
  protectedEventIds: z.array(z.string()).default([]),
  preference: z.enum(RANKING_PREFERENCES).default('minimal_disruption'),
  clarificationQuestion: z.string().nullable().optional(),
  missingInformation: z.enum(['event', 'duration', 'window', 'ambiguous_match', 'other']).nullable().optional(),
  rationale: z.string().default(''),
  unsupportedReason: z.string().nullable().optional(),
});
export type RawExtractedIntent = z.infer<typeof rawExtractedIntentSchema>;
