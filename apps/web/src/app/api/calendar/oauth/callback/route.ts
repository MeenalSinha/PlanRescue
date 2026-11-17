import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';
import { fail, ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    const errorDescription = url.searchParams.get('error_description') || errorParam;
    return fail('invalid_request', `Calendar OAuth authorization was denied: ${errorDescription}`);
  }

  if (!code || !stateRaw) {
    return fail('invalid_request', 'Missing code or state in OAuth callback');
  }

  let state: { userId: string; provider: 'google' | 'outlook'; timestamp: number };
  try {
    state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    if (!state.userId || !state.provider) {
      throw new Error('Malformed state');
    }
    // Reject state older than 15 minutes
    if (Date.now() - state.timestamp > 15 * 60 * 1000) {
      return fail('invalid_request', 'OAuth authorization state has expired. Please try connecting again.');
    }
  } catch {
    return fail('invalid_request', 'Invalid or tampered OAuth state parameter');
  }

  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  // Enforce account ownership: state userId must match authenticated user
  if (authContext.user.id !== state.userId) {
    return fail('forbidden', 'OAuth state does not match authenticated user session');
  }

  const origin = url.origin;
  const redirectUri = `${origin}/api/calendar/oauth/callback`;
  const syncManager = getCalendarSyncManager();

  if (state.provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return fail('misconfigured', 'Google OAuth credentials missing on server');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return fail('token_exchange_failed', `Failed to exchange Google OAuth code: ${errText}`);
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in;

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return fail('provider_error', 'Failed to retrieve Google user profile');
    }
    const userData = (await userRes.json()) as any;
    const email = userData.email;
    if (!email) {
      return fail('provider_error', 'Could not determine email for Google account');
    }

    const account = syncManager.connectAccount(
      authContext.user.id,
      'google',
      email,
      accessToken,
      refreshToken,
      expiresIn,
    );

    return Response.redirect(`${origin}/?connected=google&email=${encodeURIComponent(email)}`, 302);
  }

  // Microsoft
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId) {
    return fail('misconfigured', 'Microsoft OAuth credentials missing on server');
  }

  const bodyParams: Record<string, string> = {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  };
  if (clientSecret) bodyParams.client_secret = clientSecret;

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyParams),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    return fail('token_exchange_failed', `Failed to exchange Microsoft OAuth code: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as any;
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) {
    return fail('provider_error', 'Failed to retrieve Microsoft user profile');
  }
  const userData = (await userRes.json()) as any;
  const email = userData.mail || userData.userPrincipalName;
  if (!email) {
    return fail('provider_error', 'Could not determine email for Microsoft account');
  }

  const account = syncManager.connectAccount(
    authContext.user.id,
    'outlook',
    email,
    accessToken,
    refreshToken,
    expiresIn,
  );

  return Response.redirect(`${origin}/?connected=outlook&email=${encodeURIComponent(email)}`, 302);
}
