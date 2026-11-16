import { describe, expect, it, vi } from 'vitest';
import { PlanRescueApiClient } from '../src/api/client';
import { SpatialAccountPanel } from '../src/account/spatialAccountPanel';

describe('Spatial Phase 10: VR External Calendar Integration', () => {
  it('fetches calendar providers and parses provider status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: true,
        data: {
          providers: [
            {
              id: 'google',
              name: 'Google Calendar',
              description: 'Google Calendar API v3',
              connected: true,
              accountEmail: 'user@work.com',
              lastSyncAt: 1730000000000,
            },
            {
              id: 'outlook',
              name: 'Microsoft Outlook',
              description: 'Microsoft Graph Calendar',
              connected: false,
              accountEmail: null,
              lastSyncAt: null,
            },
          ],
        },
      }),
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const res = await client.getCalendarProviders();
    expect(res.providers.length).toBe(2);
    expect(res.providers[0]?.id).toBe('google');
    expect(res.providers[0]?.connected).toBe(true);
    expect(res.providers[1]?.connected).toBe(false);
  });

  it('triggers calendar synchronization from client', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: true,
        data: {
          success: true,
          provider: 'google',
          importedCount: 3,
          updatedCount: 1,
          timestamp: '2026-10-22T10:00:00Z',
        },
      }),
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const res = await client.syncCalendar('google');
    expect(res.success).toBe(true);
    expect(res.importedCount).toBe(3);
    expect(res.updatedCount).toBe(1);
  });

  it('updates SpatialAccountPanel with calendar provider info', () => {
    const panel = new SpatialAccountPanel(0.72, 0.65);
    panel.setAccount(
      {
        id: 'usr_cal_test',
        email: 'test@planrescue.local',
        displayName: 'Calendar User',
        createdAt: '2026-10-22T00:00:00Z',
        updatedAt: '2026-10-22T00:00:00Z',
      },
      {
        userId: 'usr_cal_test',
        timezone: 'Asia/Kolkata',
        workingDays: ['monday', 'tuesday'],
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
        preferredStrategy: 'minimal_disruption',
        preferredBufferMinutes: 10,
        focusPeriods: [],
        spatialComfort: { viewDistance: 1.4, handRayEnabled: true, hapticFeedback: true },
        updatedAt: '2026-10-22T00:00:00Z',
      },
    );

    panel.setCalendarProviders([
      {
        id: 'google',
        name: 'Google Calendar',
        description: 'Google Calendar',
        connected: true,
        accountEmail: 'test@work.com',
      },
    ]);

    expect(panel.group.children.length).toBeGreaterThan(0);
    panel.dispose();
  });
});
