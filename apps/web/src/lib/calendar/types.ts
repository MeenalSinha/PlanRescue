import * as z from 'zod';
import type { ScheduleEvent } from '../contract';

export const calendarProviderTypeSchema = z.enum(['google', 'outlook', 'local']);
export type CalendarProviderType = z.infer<typeof calendarProviderTypeSchema>;

export interface ExternalCalendarAccount {
  id: string;
  userId: string;
  provider: CalendarProviderType;
  accountEmail: string;
  syncStatus: 'connected' | 'syncing' | 'error' | 'disconnected';
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalEventMapping {
  id: string;
  userId: string;
  localEventId: string;
  provider: CalendarProviderType;
  providerEventId: string;
  etag?: string;
  lastSyncedAt: string;
}

export interface SyncOptions {
  userId: string;
  provider: CalendarProviderType;
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  fullSync?: boolean;
}

export interface SyncResult {
  provider: CalendarProviderType;
  accountEmail: string;
  importedCount: number;
  updatedCount: number;
  deletedCount: number;
  syncedEvents: ScheduleEvent[];
  syncCursor?: string;
  syncedAt: string;
}

export interface ExternalSyncOutboxEntry {
  id: string;
  userId: string;
  planId: string;
  provider: CalendarProviderType;
  payload: {
    eventId: string;
    originalStartTime: string;
    originalEndTime: string;
    proposedStartTime: string;
    proposedEndTime: string;
    etag?: string;
  };
  status: 'pending' | 'applied' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarProvider {
  readonly providerType: CalendarProviderType;
  listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string }>>;
  fetchEvents(timeMin: string, timeMax: string, syncToken?: string): Promise<{ events: ScheduleEvent[]; nextSyncToken?: string }>;
  patchEvent(providerEventId: string, updates: { startTime: string; endTime: string; summary?: string }, expectedEtag?: string): Promise<{ providerEventId: string; etag: string; updatedStartTime: string; updatedEndTime: string }>;
}
