import * as z from 'zod';
import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, ok, readJson } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

const disconnectSchema = z.object({
  provider: z.enum(['google', 'outlook']),
  accountEmail: z.string().email().optional(),
});

export async function POST(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const parsed = disconnectSchema.safeParse(body.value);
  if (!parsed.success) {
    const errors = Object.fromEntries(
      parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
    );
    return fail('invalid_request', 'Invalid disconnect payload', [], errors);
  }

  const syncManager = getCalendarSyncManager();
  const disconnected = syncManager.disconnectAccount(
    authContext.user.id,
    parsed.data.provider,
    parsed.data.accountEmail,
  );

  return ok({ success: disconnected, provider: parsed.data.provider });
}
