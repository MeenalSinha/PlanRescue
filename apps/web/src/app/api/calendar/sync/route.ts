import * as z from 'zod';
import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';
import { getDefaultDate, DEFAULT_PLANNING_END, DEFAULT_PLANNING_START } from '@/lib/constants';
import { loadServerConfig } from '@/lib/env';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, ok, readJson } from '@/lib/routeKit';
import { dayWindow } from '@/lib/time';

export const dynamic = 'force-dynamic';

const syncSchema = z.object({
  provider: z.enum(['google', 'outlook']),
  date: z.string().optional(),
  accountEmail: z.string().email().optional(),
});

export async function POST(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const parsed = syncSchema.safeParse(body.value);
  if (!parsed.success) {
    const errors = Object.fromEntries(
      parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
    );
    return fail('invalid_request', 'Invalid calendar sync payload', [], errors);
  }

  try {
    const config = loadServerConfig();
    const tz = authContext.preferences.timezone || config.calendarTimeZone;
    const targetDate = parsed.data.date || getDefaultDate(tz);
    const window = dayWindow(targetDate, tz);

    const syncManager = getCalendarSyncManager();
    const result = await syncManager.syncEvents(
      authContext.user.id,
      parsed.data.provider,
      window.startTime,
      window.endTime,
      parsed.data.accountEmail,
    );

    return ok(result);
  } catch (error: any) {
    return fail('internal_error', error.message || 'Failed to synchronize calendar events');
  }
}
