import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getAuthDatabase, resetAuthDbForTesting } from '../src/lib/auth/db';
import { GoogleCalendarProvider } from '../src/lib/calendar/providers/google';
import { OutlookCalendarProvider } from '../src/lib/calendar/providers/outlook';
import { CalendarSyncManager } from '../src/lib/calendar/syncManager';

describe('Spatial Phase 10: External Calendar Integrations', () => {
  let db: Database.Database;

  function insertTestUser(id: string, email = `${id}@test.com`) {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
      VALUES (?, ?, 'hash', 'Test User', 1000, 1000)
    `).run(id, email);
  }

  beforeEach(() => {
    db = getAuthDatabase(':memory:');
    resetAuthDbForTesting(db);
  });

  describe('Google Calendar Provider Adapter', () => {
    it('normalizes Google Calendar API v3 events into PlanRescue domain events', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nextSyncToken: 'sync_token_abc123',
          items: [
            {
              id: 'g_event_1',
              summary: 'Critical Doctor Appointment',
              start: { dateTime: '2026-10-22T10:00:00+05:30' },
              end: { dateTime: '2026-10-22T10:30:00+05:30' },
              etag: '"etag123"',
              status: 'confirmed',
            },
            {
              id: 'g_event_2',
              summary: 'Client Architecture Review',
              start: { dateTime: '2026-10-22T11:00:00+05:30' },
              end: { dateTime: '2026-10-22T12:00:00+05:30' },
              etag: '"etag456"',
              status: 'confirmed',
            },
            {
              id: 'g_event_3',
              summary: 'Cancelled Sync',
              start: { dateTime: '2026-10-22T13:00:00+05:30' },
              end: { dateTime: '2026-10-22T13:30:00+05:30' },
              status: 'cancelled',
            },
          ],
        }),
      });

      const provider = new GoogleCalendarProvider('mock-token', mockFetch as unknown as typeof fetch);
      const res = await provider.fetchEvents('2026-10-22T00:00:00Z', '2026-10-23T00:00:00Z');

      expect(res.events.length).toBe(2);
      expect(res.nextSyncToken).toBe('sync_token_abc123');

      const doctorEvent = res.events.find((e) => e.id === 'g_g_event_1');
      expect(doctorEvent).toBeDefined();
      expect(doctorEvent?.title).toBe('Critical Doctor Appointment');
      expect(doctorEvent?.priority).toBe('critical');
      expect(doctorEvent?.movable).toBe(false); // doctor appointment marked immovable

      const clientEvent = res.events.find((e) => e.id === 'g_g_event_2');
      expect(clientEvent?.priority).toBe('high');
      expect(clientEvent?.movable).toBe(true);
    });

    it('patches Google Calendar event with ETag protection and detects concurrent edits', async () => {
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        if (options.headers['If-Match'] === '"stale_etag"') {
          return { status: 412, ok: false };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: 'event_patch_1',
            etag: '"fresh_etag_789"',
            start: { dateTime: '2026-10-22T14:00:00+05:30' },
            end: { dateTime: '2026-10-22T15:00:00+05:30' },
          }),
        };
      });

      const provider = new GoogleCalendarProvider('mock-token', mockFetch as unknown as typeof fetch);

      // Successful patch with matching ETag
      const patchRes = await provider.patchEvent(
        'event_patch_1',
        {
          startTime: '2026-10-22T14:00:00+05:30',
          endTime: '2026-10-22T15:00:00+05:30',
        },
        '"matching_etag"',
      );

      expect(patchRes.etag).toBe('"fresh_etag_789"');

      // Concurrent modification triggers 412 Precondition Failed
      await expect(
        provider.patchEvent(
          'event_patch_1',
          {
            startTime: '2026-10-22T14:00:00+05:30',
            endTime: '2026-10-22T15:00:00+05:30',
          },
          '"stale_etag"',
        ),
      ).rejects.toThrow('modified concurrently on Google Calendar');
    });
  });

  describe('Microsoft Graph Outlook Calendar Provider Adapter', () => {
    it('normalizes Microsoft Graph events into PlanRescue domain events', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 'ms_event_1',
              subject: 'Executive Sprint Demo',
              bodyPreview: 'Sprint progress demo',
              start: { dateTime: '2026-10-22T15:00:00', timeZone: 'UTC' },
              end: { dateTime: '2026-10-22T16:00:00', timeZone: 'UTC' },
              importance: 'high',
              isCancelled: false,
              '@odata.etag': 'W/"etag_ms_1"',
            },
          ],
        }),
      });

      const provider = new OutlookCalendarProvider('mock-graph-token', mockFetch as unknown as typeof fetch);
      const res = await provider.fetchEvents('2026-10-22T00:00:00Z', '2026-10-23T00:00:00Z');

      expect(res.events.length).toBe(1);
      const event = res.events[0];
      expect(event?.id).toBe('ms_ms_event_1');
      expect(event?.title).toBe('Executive Sprint Demo');
      expect(event?.priority).toBe('high');
      expect(event?.durationMinutes).toBe(60);
    });
  });

  describe('Calendar Synchronization Manager & Outbox Reconciliation', () => {
    it('connects accounts, syncs events idempotently, and maintains mapping records', async () => {
      const fakeGoogleProvider = {
        providerType: 'google' as const,
        listCalendars: vi.fn(),
        fetchEvents: vi.fn().mockResolvedValue({
          nextSyncToken: 'cursor_1',
          events: [
            {
              id: 'g_e1',
              title: 'Team Sync',
              startTime: '2026-10-22T09:00:00+05:30',
              endTime: '2026-10-22T09:30:00+05:30',
              durationMinutes: 30,
              priority: 'medium',
              movable: true,
              category: 'meeting',
            },
          ],
        }),
        patchEvent: vi.fn(),
      };

      const syncManager = new CalendarSyncManager(db, () => fakeGoogleProvider as any);

      const userId = 'usr_test_sync';
      insertTestUser(userId);
      syncManager.connectAccount(userId, 'google', 'user@company.com');

      const accounts = syncManager.listAccounts(userId);
      expect(accounts.length).toBe(1);
      expect(accounts[0]?.provider).toBe('google');
      expect(accounts[0]?.accountEmail).toBe('user@company.com');

      // First sync: imports 1 event
      const sync1 = await syncManager.syncEvents(userId, 'google', '2026-10-22T00:00:00Z', '2026-10-23T00:00:00Z');
      expect(sync1.importedCount).toBe(1);
      expect(sync1.updatedCount).toBe(0);

      // Second sync: updates mapping without duplicate insertion (idempotent)
      const sync2 = await syncManager.syncEvents(userId, 'google', '2026-10-22T00:00:00Z', '2026-10-23T00:00:00Z');
      expect(sync2.importedCount).toBe(0);
      expect(sync2.updatedCount).toBe(1);
    });

    it('queues outbox changes on approved plan execution and reconciles with provider', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        providerEventId: 'e1',
        etag: '"updated_etag_999"',
        updatedStartTime: '2026-10-22T10:00:00+05:30',
        updatedEndTime: '2026-10-22T10:30:00+05:30',
      });

      const fakeGoogleProvider = {
        providerType: 'google' as const,
        listCalendars: vi.fn(),
        fetchEvents: vi.fn(),
        patchEvent: mockPatch,
      };

      const syncManager = new CalendarSyncManager(db, () => fakeGoogleProvider as any);
      const userId = 'usr_outbox_test';
      insertTestUser(userId);
      syncManager.connectAccount(userId, 'google', 'user@company.com');

      // Queue an event shift from an approved plan
      const outboxId = syncManager.queueOutboxChange(userId, 'plan-xyz', 'google', {
        eventId: 'g_e1',
        originalStartTime: '2026-10-22T09:30:00+05:30',
        originalEndTime: '2026-10-22T10:00:00+05:30',
        proposedStartTime: '2026-10-22T10:00:00+05:30',
        proposedEndTime: '2026-10-22T10:30:00+05:30',
      });

      expect(outboxId).toBeDefined();

      // Run reconciliation
      const recon = await syncManager.reconcileOutbox(userId, 'google');
      expect(recon.succeeded).toBe(1);
      expect(recon.failed).toBe(0);
      expect(mockPatch).toHaveBeenCalledWith(
        'g_e1',
        {
          startTime: '2026-10-22T10:00:00+05:30',
          endTime: '2026-10-22T10:30:00+05:30',
        },
        undefined,
      );
    });

    it('handles provider reconciliation failures safely without corrupting schedule', async () => {
      const mockPatch = vi.fn().mockRejectedValue(new Error('Network error'));

      const fakeGoogleProvider = {
        providerType: 'google' as const,
        listCalendars: vi.fn(),
        fetchEvents: vi.fn(),
        patchEvent: mockPatch,
      };

      const syncManager = new CalendarSyncManager(db, () => fakeGoogleProvider as any);
      const userId = 'usr_fail_test';
      insertTestUser(userId);
      syncManager.connectAccount(userId, 'google', 'user@company.com');

      syncManager.queueOutboxChange(userId, 'plan-failed', 'google', {
        eventId: 'g_e2',
        originalStartTime: '2026-10-22T11:00:00+05:30',
        originalEndTime: '2026-10-22T11:30:00+05:30',
        proposedStartTime: '2026-10-22T12:00:00+05:30',
        proposedEndTime: '2026-10-22T12:30:00+05:30',
      });

      const recon = await syncManager.reconcileOutbox(userId, 'google');
      expect(recon.succeeded).toBe(0);
      expect(recon.failed).toBe(1);
    });

    it('disconnects calendar accounts cleanly', () => {
      const syncManager = new CalendarSyncManager(db);
      const userId = 'usr_disco_test';
      insertTestUser(userId);
      syncManager.connectAccount(userId, 'google', 'user@company.com');

      expect(syncManager.listAccounts(userId).length).toBe(1);

      const disco = syncManager.disconnectAccount(userId, 'google');
      expect(disco).toBe(true);
      expect(syncManager.listAccounts(userId).length).toBe(0);
    });
  });
});
