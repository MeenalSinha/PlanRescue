import { getAuthService } from '@/lib/auth/service';
import { registerInputSchema } from '@/lib/auth/types';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, ok, readJson } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const parsed = registerInputSchema.safeParse(body.value);
  if (!parsed.success) {
    const errors = Object.fromEntries(
      parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
    );
    return fail('invalid_request', 'Invalid registration parameters', [], errors);
  }

  try {
    const authService = getAuthService();
    const result = authService.register(parsed.data);

    const headers = new Headers();
    headers.append(
      'Set-Cookie',
      `planrescue_session=${result.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
    );

    return new Response(JSON.stringify({ status: 'ok', data: result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...Object.fromEntries(headers.entries()),
      },
    });
  } catch (error: any) {
    if (error.code === 'email_taken') {
      return fail('conflict', error.message, [], { email: error.message });
    }
    return fail('internal_error', error.message || 'Registration failed');
  }
}
