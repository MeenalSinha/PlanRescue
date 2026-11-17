import * as z from 'zod';
import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, ok, readJson } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

const FORBIDDEN_TOKEN_REGEX = /(?:token_simulated|mock[-_]|dummy[-_]|fake[-_]|simulated_oauth)/i;

const connectSchema = z
  .object({
    provider: z.enum(['google', 'outlook']),
    code: z.string().min(1).optional(),
    codeVerifier: z.string().min(1).optional(),
    redirectUri: z.string().url().optional(),
    accountEmail: z.string().email().optional(),
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
  })
  .refine(
    (data) => Boolean(data.code || (data.accessToken && data.accountEmail)),
    {
      message: 'Either an OAuth authorization code or verified provider credentials (accessToken & accountEmail) must be provided.',
    },
  );

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

  const { provider, code, codeVerifier, redirectUri, accessToken, refreshToken, accountEmail } = parsed.data;

  // 1. Strict rejection of known mock, dummy, or simulated tokens
  if (accessToken && FORBIDDEN_TOKEN_REGEX.test(accessToken)) {
    return fail(
      'invalid_request',
      'Simulated and dummy tokens are strictly prohibited. Genuine OAuth credentials are required.',
    );
  }

  const syncManager = getCalendarSyncManager();

  // 2. Authorization Code Exchange
  if (code) {
    let exchangedToken: string;
    let exchangedRefresh: string | undefined;
    let verifiedEmail: string;
    let expiresIn: number | undefined;

    if (provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return fail(
          'misconfigured',
          'Google Calendar OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment.',
        );
      }

      const effectiveRedirectUri = redirectUri || `${new URL(request.url).origin}/api/calendar/oauth/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: effectiveRedirectUri,
          grant_type: 'authorization_code',
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return fail('oauth_exchange_failed', `Google token exchange failed: ${errText}`);
      }

      const tokenData = (await tokenRes.json()) as any;
      exchangedToken = tokenData.access_token;
      exchangedRefresh = tokenData.refresh_token;
      expiresIn = tokenData.expires_in;

      // Fetch user profile email
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${exchangedToken}` },
      });
      if (!userRes.ok) {
        return fail('provider_error', 'Failed to retrieve Google user profile');
      }
      const userData = (await userRes.json()) as any;
      verifiedEmail = userData.email || accountEmail;
      if (!verifiedEmail) {
        return fail('provider_error', 'Could not determine email for Google account');
      }
    } else {
      // Outlook / Microsoft Graph
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
      if (!clientId) {
        return fail(
          'misconfigured',
          'Microsoft Outlook OAuth is not configured on this server. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in environment.',
        );
      }

      const effectiveRedirectUri = redirectUri || `${new URL(request.url).origin}/api/calendar/oauth/callback`;
      const bodyParams: Record<string, string> = {
        code,
        client_id: clientId,
        redirect_uri: effectiveRedirectUri,
        grant_type: 'authorization_code',
      };
      if (clientSecret) bodyParams.client_secret = clientSecret;
      if (codeVerifier) bodyParams.code_verifier = codeVerifier;

      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(bodyParams),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return fail('oauth_exchange_failed', `Microsoft token exchange failed: ${errText}`);
      }

      const tokenData = (await tokenRes.json()) as any;
      exchangedToken = tokenData.access_token;
      exchangedRefresh = tokenData.refresh_token;
      expiresIn = tokenData.expires_in;

      // Fetch Microsoft user profile
      const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${exchangedToken}` },
      });
      if (!userRes.ok) {
        return fail('provider_error', 'Failed to retrieve Microsoft user profile');
      }
      const userData = (await userRes.json()) as any;
      verifiedEmail = userData.mail || userData.userPrincipalName || accountEmail;
      if (!verifiedEmail) {
        return fail('provider_error', 'Could not determine email for Microsoft account');
      }
    }

    try {
      const account = syncManager.connectAccount(
        authContext.user.id,
        provider,
        verifiedEmail,
        exchangedToken,
        exchangedRefresh,
        expiresIn,
      );
      return ok({ account, message: `Successfully connected ${provider} account for ${verifiedEmail}` });
    } catch (error: any) {
      return fail('internal_error', error.message || 'Failed to save connected calendar account');
    }
  }

  // 3. Direct Credential Connection (used by tests or custom provider factories)
  try {
    const targetEmail = accountEmail!;
    const activeToken = accessToken!;

    const account = syncManager.connectAccount(
      authContext.user.id,
      provider,
      targetEmail,
      activeToken,
      refreshToken,
    );

    return ok({ account, message: `Successfully connected ${provider} account` });
  } catch (error: any) {
    return fail('internal_error', error.message || 'Failed to connect calendar provider');
  }
}
