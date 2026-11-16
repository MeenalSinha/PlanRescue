import type { CalendarProvider, CalendarProviderType } from '../types';
import type { ScheduleEvent } from '../../contract';
import { toEpochMs } from '../../time';

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  etag?: string;
  status?: string;
  transparency?: 'opaque' | 'transparent';
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly providerType: CalendarProviderType = 'google';
  private readonly accessToken: string;
  private readonly fetchFn: typeof fetch;

  constructor(accessToken: string, fetchFn: typeof fetch = fetch) {
    this.accessToken = accessToken;
    this.fetchFn = fetchFn;
  }

  async listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string }>> {
    const res = await this.fetchFn('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Google Calendar listCalendars failed with status ${res.status}`);
    }

    const data = await res.json() as any;
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary,
      primary: Boolean(item.primary),
      accessRole: item.accessRole || 'reader',
    }));
  }

  async fetchEvents(timeMin: string, timeMax: string, syncToken?: string): Promise<{ events: ScheduleEvent[]; nextSyncToken?: string }> {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    if (syncToken) {
      url.searchParams.set('syncToken', syncToken);
    } else {
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
    }

    const res = await this.fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Google Calendar fetchEvents failed with status ${res.status}`);
    }

    const data = await res.json() as any;
    const rawItems: GoogleCalendarEvent[] = data.items || [];

    const events: ScheduleEvent[] = [];
    for (const item of rawItems) {
      if (item.status === 'cancelled') continue;

      const startTime = item.start.dateTime || item.start.date;
      const endTime = item.end.dateTime || item.end.date;
      if (!startTime || !endTime) continue;

      const startMs = toEpochMs(startTime);
      const endMs = toEpochMs(endTime);
      const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));

      // Infer priority from title keywords or description
      const titleLower = (item.summary || '').toLowerCase();
      const isCritical = titleLower.includes('doctor') || titleLower.includes('urgent') || titleLower.includes('board');
      const isHigh = titleLower.includes('client') || titleLower.includes('interview') || titleLower.includes('demo');
      const isLow = titleLower.includes('coffee') || titleLower.includes('optional');
      const priority = isCritical ? 'critical' : isHigh ? 'high' : isLow ? 'low' : 'medium';

      // Detect fixed/immovable flags
      const isMovable = !isCritical && !titleLower.includes('flight') && !titleLower.includes('dentist');

      events.push({
        id: `g_${item.id}`,
        title: item.summary || 'Untitled Event',
        startTime,
        endTime,
        durationMinutes,
        priority,
        movable: isMovable,
        category: 'meeting',
        notes: item.description,
      });
    }

    return {
      events,
      nextSyncToken: data.nextSyncToken || data.nextPageToken,
    };
  }

  async patchEvent(
    providerEventId: string,
    updates: { startTime: string; endTime: string; summary?: string },
    expectedEtag?: string,
  ): Promise<{ providerEventId: string; etag: string; updatedStartTime: string; updatedEndTime: string }> {
    const cleanId = providerEventId.replace(/^g_/, '');
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(cleanId)}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (expectedEtag) {
      headers['If-Match'] = expectedEtag;
    }

    const body: Record<string, any> = {
      start: { dateTime: updates.startTime },
      end: { dateTime: updates.endTime },
    };
    if (updates.summary) {
      body.summary = updates.summary;
    }

    const res = await this.fetchFn(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 412) {
      throw new Error(`Google Calendar conflict: Event ${cleanId} was modified concurrently on Google Calendar`);
    }

    if (!res.ok) {
      throw new Error(`Google Calendar patchEvent failed with status ${res.status}`);
    }

    const data = await res.json() as any;
    return {
      providerEventId: cleanId,
      etag: data.etag || res.headers.get('ETag') || `"${Date.now()}"`,
      updatedStartTime: data.start?.dateTime || updates.startTime,
      updatedEndTime: data.end?.dateTime || updates.endTime,
    };
  }
}
