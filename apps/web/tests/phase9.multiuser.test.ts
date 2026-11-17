import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { AuthService, AuthenticationError } from '../src/lib/auth/service';
import { DEFAULT_USER_ID, getAuthDatabase, resetAuthDbForTesting } from '../src/lib/auth/db';
import { CalendarSyncManager } from '../src/lib/calendar/syncManager';

describe('Phase 9-12 Multi-User Isolation & Security Hardening Tests', () => {
  let db: Database.Database;
  let authService: AuthService;
  let syncManager: CalendarSyncManager;

  beforeEach(() => {
    db = getAuthDatabase(':memory:');
    resetAuthDbForTesting(db);
    authService = new AuthService(db);
    syncManager = new CalendarSyncManager(db);
  });

  describe('Multi-User Plan Ownership Isolation', () => {
    it('prevents cross-user plan approval, execution, and rejection', () => {
      const userA = authService.register({
        email: 'usera@example.com',
        password: 'Password123!',
        displayName: 'User Alpha',
      });

      const userB = authService.register({
        email: 'userb@example.com',
        password: 'Password123!',
        displayName: 'User Beta',
      });

      const planA = 'rec_plan_alpha_1';
      const planB = 'rec_plan_beta_1';

      authService.recordPlanOwnership(planA, userA.user.id);
      authService.recordPlanOwnership(planB, userB.user.id);

      // Verify User A owns plan A, but not plan B
      expect(authService.verifyPlanOwnership(planA, userA.user.id)).toBe(true);
      expect(authService.verifyPlanOwnership(planB, userA.user.id)).toBe(false);

      // Verify User B owns plan B, but not plan A
      expect(authService.verifyPlanOwnership(planB, userB.user.id)).toBe(true);
      expect(authService.verifyPlanOwnership(planA, userB.user.id)).toBe(false);

      // Verify plan lists are strictly partitioned
      const userAPlans = authService.getUserPlanIds(userA.user.id);
      const userBPlans = authService.getUserPlanIds(userB.user.id);

      expect(userAPlans).toEqual([planA]);
      expect(userBPlans).toEqual([planB]);
    });
  });

  describe('Multi-User Calendar Account & Outbox Isolation', () => {
    it('isolates connected calendar accounts and sync outbox across users', () => {
      const userA = authService.register({
        email: 'usera_cal@example.com',
        password: 'Password123!',
        displayName: 'User Alpha Cal',
      });

      const userB = authService.register({
        email: 'userb_cal@example.com',
        password: 'Password123!',
        displayName: 'User Beta Cal',
      });

      syncManager.connectAccount(userA.user.id, 'google', 'alpha.work@gmail.com', 'tok_alpha', 'ref_alpha');
      syncManager.connectAccount(userB.user.id, 'google', 'beta.work@gmail.com', 'tok_beta', 'ref_beta');

      const accountsA = syncManager.listAccounts(userA.user.id);
      const accountsB = syncManager.listAccounts(userB.user.id);

      expect(accountsA).toHaveLength(1);
      expect(accountsA[0]!.accountEmail).toBe('alpha.work@gmail.com');
      expect(accountsA[0]!.userId).toBe(userA.user.id);

      expect(accountsB).toHaveLength(1);
      expect(accountsB[0]!.accountEmail).toBe('beta.work@gmail.com');
      expect(accountsB[0]!.userId).toBe(userB.user.id);

      // Verify queueing outbox for User A does not appear in User B's outbox
      syncManager.queueOutboxChange(userA.user.id, 'plan_a', 'google', {
        eventId: 'evt_1',
        originalStartTime: '2026-10-22T09:00:00Z',
        originalEndTime: '2026-10-22T10:00:00Z',
        proposedStartTime: '2026-10-22T10:00:00Z',
        proposedEndTime: '2026-10-22T11:00:00Z',
      });

      const outboxRowsUserB = db
        .prepare('SELECT * FROM external_sync_outbox WHERE user_id = ?')
        .all(userB.user.id);
      expect(outboxRowsUserB).toHaveLength(0);

      const outboxRowsUserA = db
        .prepare('SELECT * FROM external_sync_outbox WHERE user_id = ?')
        .all(userA.user.id);
      expect(outboxRowsUserA).toHaveLength(1);
    });
  });

  describe('Production Auth Guard', () => {
    it('rejects unauthenticated requests when NODE_ENV === "production"', () => {
      const origEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = 'production';

        const req = new Request('https://planrescue.example.com/api/recovery/plans');
        expect(() => authService.authenticateRequest(req)).toThrow(AuthenticationError);
      } finally {
        (process.env as any).NODE_ENV = origEnv;
      }
    });

    it('accepts valid session tokens in production', () => {
      const origEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = 'production';

        const user = authService.register({
          email: 'produser@example.com',
          password: 'Password123!',
          displayName: 'Prod User',
        });

        const req = new Request('https://planrescue.example.com/api/recovery/plans', {
          headers: {
            Authorization: `Bearer ${user.sessionToken}`,
          },
        });

        const authContext = authService.authenticateRequest(req);
        expect(authContext.user.id).toBe(user.user.id);
        expect(authContext.isDefault).toBe(false);
      } finally {
        (process.env as any).NODE_ENV = origEnv;
      }
    });
  });
});
