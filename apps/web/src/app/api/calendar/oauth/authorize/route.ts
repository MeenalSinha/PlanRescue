import { randomBytes } from 'node:crypto';
import { getAuthService } from '@/lib/auth/service';
import { fail, ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider')?.toLowerCase();

  if (provider !== 'google' && provider !== 'outlook') {
    return fail('invalid_request', 'Invalid provider. Supported providers are "google" or "outlook".');
  }

  const origin = url.origin;
  const redirectUri = `${origin}/api/calendar/oauth/callback`;
  const state = Buffer.from(
    JSON.stringify({
      userId: authContext.user.id,
      provider,
      nonce: randomBytes(16).toString('hex'),
      timestamp: Date.now(),
    }),
  ).toString('base64url');

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return fail(
        'misconfigured',
        'Google Calendar OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
    );
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    if (url.searchParams.get('redirect') === 'true') {
      return Response.redirect(authUrl.toString(), 302);
    }
    return ok({ authorizationUrl: authUrl.toString(), provider, state });
  }

  // Microsoft Outlook
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return fail(
      'misconfigured',
      'Microsoft Outlook OAuth is not configured on this server. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.',
    );
  }

  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'Calendars.ReadWrite offline_access User.Read');
  authUrl.searchParams.set('state', state);

  if (url.searchParams.get('redirect') === 'true') {
    return Response.redirect(authUrl.toString(), 302);
  }
  return ok({ authorizationUrl: authUrl.toString(), provider, state });
}
