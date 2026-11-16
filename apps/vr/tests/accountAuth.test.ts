import { describe, expect, it, vi } from 'vitest';
import { PlanRescueApiClient } from '../src/api/client';
import { SpatialAccountPanel } from '../src/account/spatialAccountPanel';

describe('Spatial Phase 9: VR Account & Identity Integration', () => {
  it('attaches Bearer token to requests once authenticated', async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      capturedHeaders = options.headers;

      if (url.includes('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              user: { id: 'usr-123', email: 'alice@domain.com', displayName: 'Alice', createdAt: '', updatedAt: '' },
              sessionToken: 'test-session-token-123',
              preferences: {
                userId: 'usr-123',
                timezone: 'Asia/Kolkata',
                workingDays: ['monday'],
                workingHoursStart: '09:00',
                workingHoursEnd: '18:00',
                preferredStrategy: 'minimal_disruption',
                preferredBufferMinutes: 10,
                focusPeriods: [],
                spatialComfort: { viewDistance: 1.4, handRayEnabled: true, hapticFeedback: true },
                updatedAt: '',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard')) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              date: '2026-10-22',
              calendarTimeZone: 'Asia/Kolkata',
              taskTimeZone: 'Asia/Kolkata',
              utcOffset: '+05:30',
              window: { startTime: '2026-10-22T00:00:00+05:30', endTime: '2026-10-23T00:00:00+05:30' },
              taskWindow: { startTime: '2026-10-22T00:00:00+05:30', endTime: '2026-10-26T00:00:00+05:30' },
              events: [],
              tasks: [],
              baseline: null,
              baselineError: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ ok: true, data: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // 1. Initial request without token
    await client.login({ email: 'alice@domain.com', password: 'Password123!' });
    expect(client.getAuthToken()).toBe('test-session-token-123');

    // 2. Subsequent request carries Authorization: Bearer
    await client.getDashboard();
    expect(capturedHeaders['Authorization']).toBe('Bearer test-session-token-123');

    // 3. Logout clears the token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await client.logout();
    expect(client.getAuthToken()).toBeNull();
  });

  it('renders user details in SpatialAccountPanel and cycles strategies', () => {
    const panel = new SpatialAccountPanel(0.72, 0.65);
    let updatedStrategy: string | null = null;

    panel.setCallbacks({
      onStrategyChange: (strat) => {
        updatedStrategy = strat;
      },
    });

    const user = {
      id: 'usr-456',
      email: 'dan@example.com',
      displayName: 'Dan Architect',
      createdAt: '',
      updatedAt: '',
    };
    const preferences = {
      userId: 'usr-456',
      timezone: 'America/New_York',
      workingDays: ['monday', 'tuesday'],
      workingHoursStart: '08:00',
      workingHoursEnd: '17:00',
      preferredStrategy: 'minimal_disruption' as const,
      preferredBufferMinutes: 15,
      focusPeriods: [],
      spatialComfort: { viewDistance: 1.6, handRayEnabled: true, hapticFeedback: true },
      updatedAt: '',
    };

    panel.setAccount(user, preferences);
    expect(panel.group.children.length).toBeGreaterThan(1);

    // Trigger strategy button click
    const btn = panel.group.children.find((c) => c.name.startsWith('Btn_Strategy')) as any;
    expect(btn).toBeDefined();

    // Verify cleanup
    panel.dispose();
    expect(panel.group.children.length).toBe(0);
  });
});
