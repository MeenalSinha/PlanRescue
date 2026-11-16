import { randomUUID } from 'node:crypto';
import type { Db } from '../auth/db';
import { getAuthDatabase } from '../auth/db';
import type {
  CalendarProvider,
  CalendarProviderType,
  ExternalCalendarAccount,
  ExternalEventMapping,
  SyncResult,
} from './types';
import { GoogleCalendarProvider } from './providers/google';
import { OutlookCalendarProvider } from './providers/outlook';

export class CalendarSyncManager {
  private readonly db: Db;
  private customProviderFactory?: (type: CalendarProviderType, token: string) => CalendarProvider;

  constructor(db?: Db, providerFactory?: (type: CalendarProviderType, token: string) => CalendarProvider) {
    this.db = db || getAuthDatabase();
    this.customProviderFactory = providerFactory;
  }

  getProvider(type: CalendarProviderType, accessToken: string): CalendarProvider {
    if (this.customProviderFactory) {
      return this.customProviderFactory(type, accessToken);
    }
    switch (type) {
      case 'google':
        return new GoogleCalendarProvider(accessToken);
      case 'outlook':
        return new OutlookCalendarProvider(accessToken);
      default:
        throw new Error(`Unsupported calendar provider: ${type}`);
    }
  }

  connectAccount(
    userId: string,
    provider: CalendarProviderType,
    accountEmail: string,
    accessToken = 'mock-access-token',
    refreshToken = 'mock-refresh-token',
  ): ExternalCalendarAccount {
    const id = `cal_acc_${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO external_calendar_accounts (
          id, user_id, provider, account_email, access_token, encrypted_refresh_token,
          sync_status, last_synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?)
        ON CONFLICT(user_id, provider, account_email) DO UPDATE SET
          access_token = excluded.access_token,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          sync_status = 'connected',
          updated_at = excluded.updated_at
      `)
      .run(id, userId, provider, accountEmail.toLowerCase(), accessToken, refreshToken, now, now, now);

    return this.getAccount(userId, provider, accountEmail)!;
  }

  getAccount(userId: string, provider: CalendarProviderType, accountEmail?: string): ExternalCalendarAccount | null {
    let sql = 'SELECT * FROM external_calendar_accounts WHERE user_id = ? AND provider = ?';
    const params: string[] = [userId, provider];
    if (accountEmail) {
      sql += ' AND account_email = ?';
      params.push(accountEmail.toLowerCase());
    }
    const row = this.db.prepare(sql).get(...params) as any;
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      accountEmail: row.account_email,
      syncStatus: row.sync_status,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listAccounts(userId: string): ExternalCalendarAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM external_calendar_accounts WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as any[];

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      provider: r.provider,
      accountEmail: r.account_email,
      syncStatus: r.sync_status,
      lastSyncedAt: r.last_synced_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  disconnectAccount(userId: string, provider: CalendarProviderType, accountEmail?: string): boolean {
    let sql = 'DELETE FROM external_calendar_accounts WHERE user_id = ? AND provider = ?';
    const params: string[] = [userId, provider];
    if (accountEmail) {
      sql += ' AND account_email = ?';
      params.push(accountEmail.toLowerCase());
    }
    const result = this.db.prepare(sql).run(...params);
    return result.changes > 0;
  }

  async syncEvents(
    userId: string,
    providerType: CalendarProviderType,
    timeMin: string,
    timeMax: string,
    accountEmail?: string,
  ): Promise<SyncResult> {
    const account = this.getAccount(userId, providerType, accountEmail);
    if (!account) {
      throw new Error(`No connected ${providerType} account found for user ${userId}`);
    }

    const row = this.db
      .prepare('SELECT access_token, sync_cursor FROM external_calendar_accounts WHERE id = ?')
      .get(account.id) as any;

    const provider = this.getProvider(providerType, row.access_token || 'dummy-token');
    const { events, nextSyncToken } = await provider.fetchEvents(timeMin, timeMax, row.sync_cursor);

    const now = new Date().toISOString();
    let imported = 0;
    let updated = 0;

    const tx = this.db.transaction(() => {
      for (const ev of events) {
        const cleanProviderEventId = ev.id.replace(/^(g_|ms_)/, '');

        const mappingRow = this.db
          .prepare('SELECT id FROM external_calendar_mappings WHERE user_id = ? AND provider = ? AND provider_event_id = ?')
          .get(userId, providerType, cleanProviderEventId) as any;

        if (mappingRow) {
          this.db
            .prepare(`
              UPDATE external_calendar_mappings
                 SET last_synced_at = ?
               WHERE id = ?
            `)
            .run(now, mappingRow.id);
          updated++;
        } else {
          this.db
            .prepare(`
              INSERT INTO external_calendar_mappings (
                id, user_id, local_event_id, provider, provider_event_id, etag, last_synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(randomUUID(), userId, ev.id, providerType, cleanProviderEventId, `"${Date.now()}"`, now);
          imported++;
        }
      }

      this.db
        .prepare(`
          UPDATE external_calendar_accounts
             SET sync_status = 'connected',
                 last_synced_at = ?,
                 sync_cursor = ?,
                 updated_at = ?
           WHERE id = ?
        `)
        .run(now, nextSyncToken || null, now, account.id);
    });
    tx();

    return {
      provider: providerType,
      accountEmail: account.accountEmail,
      importedCount: imported,
      updatedCount: updated,
      deletedCount: 0,
      syncedEvents: events,
      syncCursor: nextSyncToken,
      syncedAt: now,
    };
  }

  queueOutboxChange(
    userId: string,
    planId: string,
    provider: CalendarProviderType,
    change: {
      eventId: string;
      originalStartTime: string;
      originalEndTime: string;
      proposedStartTime: string;
      proposedEndTime: string;
    },
  ): string {
    const id = `outbox_${randomUUID()}`;
    const now = new Date().toISOString();

    // Look up existing etag from mapping if present
    const cleanId = change.eventId.replace(/^(g_|ms_)/, '');
    const mapping = this.db
      .prepare('SELECT etag FROM external_calendar_mappings WHERE user_id = ? AND provider = ? AND provider_event_id = ?')
      .get(userId, provider, cleanId) as any;

    const payload = {
      ...change,
      etag: mapping?.etag,
    };

    this.db
      .prepare(`
        INSERT INTO external_sync_outbox (
          id, user_id, plan_id, provider, payload_json, status, attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `)
      .run(id, userId, planId, provider, JSON.stringify(payload), now, now);

    return id;
  }

  async reconcileOutbox(userId: string, providerType: CalendarProviderType): Promise<{ succeeded: number; failed: number }> {
    const entries = this.db
      .prepare(`
        SELECT * FROM external_sync_outbox
        WHERE user_id = ? AND provider = ? AND status = 'pending'
        ORDER BY created_at ASC
      `)
      .all(userId, providerType) as any[];

    if (entries.length === 0) return { succeeded: 0, failed: 0 };

    const account = this.getAccount(userId, providerType);
    if (!account) {
      throw new Error(`Cannot reconcile outbox: no connected account for ${providerType}`);
    }

    const row = this.db.prepare('SELECT access_token FROM external_calendar_accounts WHERE id = ?').get(account.id) as any;
    const provider = this.getProvider(providerType, row.access_token || 'dummy-token');

    let succeeded = 0;
    let failed = 0;

    for (const entry of entries) {
      const payload = JSON.parse(entry.payload_json);
      const now = new Date().toISOString();

      try {
        const patchResult = await provider.patchEvent(
          payload.eventId,
          {
            startTime: payload.proposedStartTime,
            endTime: payload.proposedEndTime,
          },
          payload.etag,
        );

        // Update mapping etag
        this.db
          .prepare(`
            UPDATE external_calendar_mappings
               SET etag = ?, last_synced_at = ?
             WHERE user_id = ? AND provider = ? AND provider_event_id = ?
          `)
          .run(patchResult.etag, now, userId, providerType, patchResult.providerEventId);

        // Mark outbox entry applied
        this.db
          .prepare(`
            UPDATE external_sync_outbox
               SET status = 'applied', attempts = attempts + 1, updated_at = ?
             WHERE id = ?
          `)
          .run(now, entry.id);

        succeeded++;
      } catch (err: any) {
        failed++;
        this.db
          .prepare(`
            UPDATE external_sync_outbox
               SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ?
             WHERE id = ?
          `)
          .run(err.message || String(err), now, entry.id);
      }
    }

    return { succeeded, failed };
  }
}

let syncManagerSingleton: CalendarSyncManager | null = null;
export function getCalendarSyncManager(): CalendarSyncManager {
  if (!syncManagerSingleton) {
    syncManagerSingleton = new CalendarSyncManager();
  }
  return syncManagerSingleton;
}
