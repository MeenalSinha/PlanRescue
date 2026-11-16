import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { AuthService } from '../src/lib/auth/service';
import { DEFAULT_USER_ID, getAuthDatabase, resetAuthDbForTesting } from '../src/lib/auth/db';

describe('Spatial Phase 9: User Accounts, Identity & Personalization', () => {
  let db: Database.Database;
  let authService: AuthService;

  beforeEach(() => {
    // In-memory SQLite for high-speed isolated unit testing
    db = getAuthDatabase(':memory:');
    resetAuthDbForTesting(db);
    authService = new AuthService(db);
  });

  describe('Account Registration & Validation', () => {
    it('registers a new user with secure password hash and default preferences', () => {
      const res = authService.register({
        email: 'alice@example.com',
        password: 'Password123!',
        displayName: 'Alice Architect',
      });

      expect(res.user.id).toMatch(/^usr_/);
      expect(res.user.email).toBe('alice@example.com');
      expect(res.user.displayName).toBe('Alice Architect');
      expect(res.sessionToken).toBeDefined();
      expect(res.sessionToken.length).toBe(64);

      // Verify preferences were initialized
      expect(res.preferences.userId).toBe(res.user.id);
      expect(res.preferences.timezone).toBe('Asia/Kolkata');
      expect(res.preferences.preferredStrategy).toBe('minimal_disruption');
      expect(res.preferences.preferredBufferMinutes).toBe(10);
    });

    it('rejects duplicate registration with identical email (case-insensitive)', () => {
      authService.register({
        email: 'alice@example.com',
        password: 'Password123!',
        displayName: 'Alice Architect',
      });

      expect(() =>
        authService.register({
          email: 'ALICE@EXAMPLE.COM',
          password: 'AnotherPassword!',
          displayName: 'Alice Duplicate',
        }),
      ).toThrow('An account with this email already exists');
    });
  });

  describe('Authentication & Session Management', () => {
    it('authenticates valid credentials and creates active session', () => {
      authService.register({
        email: 'bob@example.com',
        password: 'SecureBobPassword2026',
        displayName: 'Bob Builder',
      });

      const loginRes = authService.login({
        email: 'bob@example.com',
        password: 'SecureBobPassword2026',
      });

      expect(loginRes.user.email).toBe('bob@example.com');
      expect(loginRes.sessionToken).toBeDefined();

      const session = authService.getSession(loginRes.sessionToken);
      expect(session).not.toBeNull();
      expect(session?.user.id).toBe(loginRes.user.id);
      expect(session?.user.displayName).toBe('Bob Builder');
    });

    it('rejects invalid password attempts', () => {
      authService.register({
        email: 'bob@example.com',
        password: 'CorrectPassword123',
        displayName: 'Bob',
      });

      expect(() =>
        authService.login({
          email: 'bob@example.com',
          password: 'WrongPassword!',
        }),
      ).toThrow('Invalid email or password');
    });

    it('invalidates session upon logout', () => {
      const reg = authService.register({
        email: 'carol@example.com',
        password: 'PasswordCarol123',
        displayName: 'Carol',
      });

      expect(authService.getSession(reg.sessionToken)).not.toBeNull();

      authService.logout(reg.sessionToken);

      expect(authService.getSession(reg.sessionToken)).toBeNull();
    });
  });

  describe('User Personalization & Preferences', () => {
    it('persists and updates user scheduling preferences and spatial comfort settings', () => {
      const reg = authService.register({
        email: 'dan@example.com',
        password: 'DanPassword2026!',
        displayName: 'Dan Designer',
      });

      const updated = authService.updatePreferences(reg.user.id, {
        timezone: 'America/New_York',
        preferredStrategy: 'buffered_transitions',
        preferredBufferMinutes: 15,
        workingHoursStart: '08:30',
        workingHoursEnd: '17:30',
        focusPeriods: [
          {
            id: 'focus-morning',
            title: 'Deep Architecture Focus',
            startTime: '09:00',
            endTime: '11:00',
            daysOfWeek: ['monday', 'wednesday', 'friday'],
          },
        ],
        spatialComfort: {
          viewDistance: 1.8,
          handRayEnabled: true,
          hapticFeedback: false,
        },
      });

      expect(updated.timezone).toBe('America/New_York');
      expect(updated.preferredStrategy).toBe('buffered_transitions');
      expect(updated.preferredBufferMinutes).toBe(15);
      expect(updated.focusPeriods.length).toBe(1);
      expect(updated.focusPeriods[0]?.title).toBe('Deep Architecture Focus');
      expect(updated.spatialComfort.viewDistance).toBe(1.8);

      // Re-query from database to verify persistence
      const fresh = authService.getPreferences(reg.user.id);
      expect(fresh.timezone).toBe('America/New_York');
      expect(fresh.preferredStrategy).toBe('buffered_transitions');
      expect(fresh.spatialComfort.viewDistance).toBe(1.8);
    });
  });

  describe('Multi-User Data Isolation & Authorization', () => {
    it('strictly isolates recovery plan ownership between users and denies cross-user access', () => {
      const alice = authService.register({
        email: 'alice@domain.com',
        password: 'PasswordAlice!',
        displayName: 'Alice',
      });

      const bob = authService.register({
        email: 'bob@domain.com',
        password: 'PasswordBob!',
        displayName: 'Bob',
      });

      const alicePlanId = 'plan_rec_alice_123';
      authService.recordPlanOwnership(alicePlanId, alice.user.id);

      // Alice owns her plan
      expect(authService.verifyPlanOwnership(alicePlanId, alice.user.id)).toBe(true);

      // Bob does NOT own Alice's plan
      expect(authService.verifyPlanOwnership(alicePlanId, bob.user.id)).toBe(false);

      // Default user does NOT own Alice's plan
      expect(authService.verifyPlanOwnership(alicePlanId, DEFAULT_USER_ID)).toBe(false);
    });

    it('falls back to default user for unauthenticated requests during baseline development', () => {
      const mockReq = new Request('http://localhost:3000/api/dashboard');
      const authContext = authService.authenticateRequest(mockReq);

      expect(authContext.isDefault).toBe(true);
      expect(authContext.user.id).toBe(DEFAULT_USER_ID);
      expect(authContext.preferences.preferredStrategy).toBe('minimal_disruption');
    });

    it('extracts and validates authenticated user from Bearer header', () => {
      const reg = authService.register({
        email: 'eva@domain.com',
        password: 'PasswordEva!',
        displayName: 'Eva Engineer',
      });

      const reqWithBearer = new Request('http://localhost:3000/api/dashboard', {
        headers: {
          authorization: `Bearer ${reg.sessionToken}`,
        },
      });

      const authContext = authService.authenticateRequest(reqWithBearer);
      expect(authContext.isDefault).toBe(false);
      expect(authContext.user.id).toBe(reg.user.id);
      expect(authContext.user.email).toBe('eva@domain.com');
    });
  });
});
