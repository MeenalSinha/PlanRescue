import { getAuthService } from '@/lib/auth/service';
import { userPreferencesSchema } from '@/lib/auth/types';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, ok, readJson } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  const preferences = authService.getPreferences(authContext.user.id);
  return ok(preferences);
}

export async function PUT(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const partialSchema = userPreferencesSchema.partial();
  const parsed = partialSchema.safeParse(body.value);
  if (!parsed.success) {
    const errors = Object.fromEntries(
      parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
    );
    return fail('invalid_request', 'Invalid preferences payload', [], errors);
  }

  const updated = authService.updatePreferences(authContext.user.id, parsed.data);
  return ok(updated);
}
