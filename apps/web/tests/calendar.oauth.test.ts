import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getAuthDatabase, resetAuthDbForTesting } from '../src/lib/auth/db';
import { AuthService } from '../src/lib/auth/service';
import { POST as connectHandler } from '../src/app/api/calendar/connect/route';
import { GET as authorizeHandler } from '../src/app/api/calendar/oauth/authorize/route';
import { GET as callbackHandler } from '../src/app/api/calendar/oauth/callback/route';

describe('Real Calendar OAuth Flow & Connect Route Verification', () => {
  let db: Database.Database;
  let authService: AuthService;
  let testUserId: string;
  let sessionToken: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = getAuthDatabase(':memory:');
    resetAuthDbForTesting(db);
    authService = new AuthService(db);

    const reg = authService.register({
      email: 'oauth.test@user.com',
      password: 'SecurePassword123!',
      displayName: 'OAuth Test User',
    });
    testUserId = reg.user.id;
    sessionToken = reg.sessionToken;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createAuthRequest(url: string, method = 'GET', body?: unknown): Request {
    return new Request(url, {
      method,
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  describe('POST /api/calendar/connect', () => {
    it('strictly rejects simulated, mock, or dummy tokens', async () => {
      const forbiddenTokens = [
        'token_simulated_oauth_2026',
        'mock-access-token',
        'dummy-token',
        'fake-token-123',
      ];

      for (const token of forbiddenTokens) {
        const req = createAuthRequest('http://127.0.0.1:3000/api/calendar/connect', 'POST', {
          provider: 'google',
          accountEmail: 'user@gmail.com',
          accessToken: token,
        });

        const res = await connectHandler(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.code).toBe('invalid_request');
        expect(data.error.message).toContain('Simulated and dummy tokens are strictly prohibited');
      }
    });

    it('rejects code exchange when OAuth credentials are not configured on server', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const req = createAuthRequest('http://127.0.0.1:3000/api/calendar/connect', 'POST', {
        provider: 'google',
        code: 'auth_code_from_user',
      });

      const res = await connectHandler(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('misconfigured');
    });

    it('accepts genuine verified provider credentials for custom provider factories', async () => {
      const req = createAuthRequest('http://127.0.0.1:3000/api/calendar/connect', 'POST', {
        provider: 'google',
        accountEmail: 'real.user@gmail.com',
        accessToken: 'ya29.genuine_oauth2_verified_token_payload',
        refreshToken: '1//genuine_refresh_token_payload',
      });

      const res = await connectHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data.account.accountEmail).toBe('real.user@gmail.com');
      expect(data.data.account.syncStatus).toBe('connected');
    });
  });

  describe('GET /api/calendar/oauth/authorize', () => {
    it('rejects unsupported calendar providers', async () => {
      const req = createAuthRequest('http://127.0.0.1:3000/api/calendar/oauth/authorize?provider=yahoo');
      const res = await authorizeHandler(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('invalid_request');
    });

    it('returns misconfigured when provider credentials are missing', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const req = createAuthRequest('http://127.0.0.1:3000/api/calendar/oauth/authorize?provider=google');
      const res = await authorizeHandler(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('misconfigured');
    });

    it('generates secure OAuth authorization URL with state and scopes when configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

      const req = createAuthRequest('http://127.0.0.1:3000/api/calendar/oauth/authorize?provider=google');
      const res = await authorizeHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data.authorizationUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(data.data.authorizationUrl).toContain('client_id=test-google-client-id.apps.googleusercontent.com');
      expect(data.data.authorizationUrl).toContain('state=');
      expect(data.data.authorizationUrl).toContain('calendar.events');
    });
  });

  describe('GET /api/calendar/oauth/callback', () => {
    it('rejects callback with provider error parameter', async () => {
      const req = createAuthRequest(
        'http://127.0.0.1:3000/api/calendar/oauth/callback?error=access_denied&error_description=User%20denied%20access',
      );
      const res = await callbackHandler(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('invalid_request');
    });

    it('rejects callback with invalid or tampered state', async () => {
      const req = createAuthRequest(
        'http://127.0.0.1:3000/api/calendar/oauth/callback?code=test_code&state=not_valid_base64_json',
      );
      const res = await callbackHandler(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('invalid_request');
    });

    it('rejects callback with expired state (> 15 minutes old)', async () => {
      const expiredState = Buffer.from(
        JSON.stringify({
          userId: testUserId,
          provider: 'google',
          timestamp: Date.now() - 20 * 60 * 1000, // 20 mins ago
        }),
      ).toString('base64url');

      const req = createAuthRequest(
        `http://127.0.0.1:3000/api/calendar/oauth/callback?code=test_code&state=${expiredState}`,
      );
      const res = await callbackHandler(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('invalid_request');
    });

    it('rejects callback when state user ID does not match current session', async () => {
      const mismatchedState = Buffer.from(
        JSON.stringify({
          userId: 'different_user_id',
          provider: 'google',
          timestamp: Date.now(),
        }),
      ).toString('base64url');

      const req = createAuthRequest(
        `http://127.0.0.1:3000/api/calendar/oauth/callback?code=test_code&state=${mismatchedState}`,
      );
      const res = await callbackHandler(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('forbidden');
    });
  });
});
