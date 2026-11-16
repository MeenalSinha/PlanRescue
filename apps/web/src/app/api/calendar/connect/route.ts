import * as z from 'zod';
import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, ok, readJson } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

const connectSchema = z.object({
  provider: z.enum(['google', 'outlook']),
  accountEmail: z.string().email(),
  accessToken: z.string().default('token_simulated_oauth_2026'),
  refreshToken: z.string().default('refresh_simulated_oauth_2026'),
});

export async function POST(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const parsed = connectSchema.safeParse(body.value);
  if (!parsed.success) {
    const errors = Object.fromEntries(
      parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
    );
    return fail('invalid_request', 'Invalid calendar connection payload', [], errors);
  }

  try {
    const syncManager = getCalendarSyncManager();
    const account = syncManager.connectAccount(
      authContext.user.id,
      parsed.data.provider,
      parsed.data.accountEmail,
      parsed.data.accessToken,
      parsed.data.refreshToken,
    );

    return ok({ account, message: `Successfully connected ${parsed.data.provider} account` });
  } catch (error: any) {
    return fail('internal_error', error.message || 'Failed to connect calendar provider');
  }
}
