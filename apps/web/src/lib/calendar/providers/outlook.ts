import type { CalendarProvider, CalendarProviderType } from '../types';
import type { ScheduleEvent } from '../../contract';
import { toEpochMs } from '../../time';

export interface OutlookCalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  importance?: 'low' | 'normal' | 'high';
  isCancelled?: boolean;
  '@odata.etag'?: string;
}

export class OutlookCalendarProvider implements CalendarProvider {
  readonly providerType: CalendarProviderType = 'outlook';
  private readonly accessToken: string;
  private readonly fetchFn: typeof fetch;

  constructor(accessToken: string, fetchFn: typeof fetch = fetch) {
    this.accessToken = accessToken;
    this.fetchFn = fetchFn;
  }

  async listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string }>> {
    const res = await this.fetchFn('https://graph.microsoft.com/v1.0/me/calendars', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Outlook Calendar listCalendars failed with status ${res.status}`);
    }

    const data = await res.json() as any;
    return (data.value || []).map((item: any) => ({
      id: item.id,
      summary: item.name || 'Outlook Calendar',
      primary: Boolean(item.isDefaultCalendar),
      accessRole: item.canEdit ? 'owner' : 'reader',
    }));
  }

  async fetchEvents(timeMin: string, timeMax: string, deltaLink?: string): Promise<{ events: ScheduleEvent[]; nextSyncToken?: string }> {
    const url = deltaLink
      ? new URL(deltaLink)
      : new URL('https://graph.microsoft.com/v1.0/me/calendarview');

    if (!deltaLink) {
      url.searchParams.set('startDateTime', timeMin);
      url.searchParams.set('endDateTime', timeMax);
      url.searchParams.set('$top', '100');
    }

    const res = await this.fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        Prefer: 'outlook.timezone="UTC"',
      },
    });

    if (!res.ok) {
      throw new Error(`Outlook Calendar fetchEvents failed with status ${res.status}`);
    }

    const data = await res.json() as any;
    const rawItems: OutlookCalendarEvent[] = data.value || [];

    const events: ScheduleEvent[] = [];
    for (const item of rawItems) {
      if (item.isCancelled) continue;

      let startIso = item.start?.dateTime;
      let endIso = item.end?.dateTime;
      if (!startIso || !endIso) continue;

      if (!startIso.endsWith('Z') && !startIso.includes('+')) {
        startIso += 'Z';
      }
      if (!endIso.endsWith('Z') && !endIso.includes('+')) {
        endIso += 'Z';
      }

      const startMs = toEpochMs(startIso);
      const endMs = toEpochMs(endIso);
      const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));

      const title = item.subject || 'Untitled Event';
      const titleLower = title.toLowerCase();

      const isCritical = titleLower.includes('doctor') || titleLower.includes('urgent');
      const priority: 'critical' | 'high' | 'medium' | 'low' = isCritical
        ? 'critical'
        : item.importance === 'high'
          ? 'high'
          : item.importance === 'low'
            ? 'low'
            : 'medium';

      const isMovable = priority !== 'critical' && !titleLower.includes('appointment');

      events.push({
        id: `ms_${item.id}`,
        title,
        startTime: startIso,
        endTime: endIso,
        durationMinutes,
        priority,
        movable: isMovable,
        category: 'meeting',
        notes: item.bodyPreview,
      });
    }

    return {
      events,
      nextSyncToken: data['@odata.deltaLink'] || data['@odata.nextLink'],
    };
  }

  async patchEvent(
    providerEventId: string,
    updates: { startTime: string; endTime: string; summary?: string },
    expectedEtag?: string,
  ): Promise<{ providerEventId: string; etag: string; updatedStartTime: string; updatedEndTime: string }> {
    const cleanId = providerEventId.replace(/^ms_/, '');
    const url = `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(cleanId)}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (expectedEtag) {
      headers['If-Match'] = expectedEtag;
    }

    const body: Record<string, any> = {
      start: { dateTime: updates.startTime, timeZone: 'UTC' },
      end: { dateTime: updates.endTime, timeZone: 'UTC' },
    };
    if (updates.summary) {
      body.subject = updates.summary;
    }

    const res = await this.fetchFn(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 412) {
      throw new Error(`Outlook Calendar conflict: Event ${cleanId} was modified concurrently on Microsoft Graph`);
    }

    if (!res.ok) {
      throw new Error(`Outlook Calendar patchEvent failed with status ${res.status}`);
    }

    const data = await res.json() as any;
    return {
      providerEventId: cleanId,
      etag: data['@odata.etag'] || res.headers.get('ETag') || `"${Date.now()}"`,
      updatedStartTime: data.start?.dateTime || updates.startTime,
      updatedEndTime: data.end?.dateTime || updates.endTime,
    };
  }
}
