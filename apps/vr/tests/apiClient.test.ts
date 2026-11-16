import { describe, expect, it, vi } from 'vitest';
import { PlanRescueApiClient } from '../src/api/client';
import { ApiClientError, ApiTimeoutError, ApiValidationError } from '../src/api/errors';

describe('PlanRescueApiClient', () => {
  it('parses a valid dashboard response', async () => {
    const mockData = {
      date: '2026-10-22',
      calendarTimeZone: 'Asia/Kolkata',
      taskTimeZone: 'Asia/Kolkata',
      utcOffset: '+05:30',
      window: { startTime: '2026-10-22T00:00:00+05:30', endTime: '2026-10-23T00:00:00+05:30' },
      taskWindow: { startTime: '2026-10-22T00:00:00+05:30', endTime: '2026-10-26T00:00:00+05:30' },
      events: [
        {
          id: 'evt-001',
          title: 'Design Review',
          startTime: '2026-10-22T09:00:00+05:30',
          endTime: '2026-10-22T10:00:00+05:30',
          durationMinutes: 60,
          priority: 'high',
          movable: true,
          category: 'meeting',
        },
      ],
      tasks: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: mockData }),
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.getDashboard('2026-10-22');
    expect(result.events.length).toBe(1);
    expect(result.events[0]?.id).toBe('evt-001');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/dashboard?date=2026-10-22',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects with ApiClientError when server returns an error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        error: { code: 'invalid_request', message: 'The date is invalid' },
      }),
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.getDashboard('bad-date')).rejects.toThrow(ApiClientError);
  });

  it('rejects with ApiValidationError when response violates contract schema', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          // Missing required fields
          date: '2026-10-22',
        },
      }),
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.getDashboard('2026-10-22')).rejects.toThrow(ApiValidationError);
  });

  it('handles request abortion via AbortController', async () => {
    const abortController = new AbortController();
    abortController.abort(); // already aborted

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(client.getDashboard('2026-10-22', abortController.signal)).rejects.toThrow(ApiClientError);
  });

  it('never retries non-idempotent operations like applyPlan', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          error: { code: 'mcp_unavailable', message: 'Server temporarily unavailable' },
        }),
      });
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      maxRetries: 2,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.applyPlan('plan-123')).rejects.toThrow(ApiClientError);
    // Crucial safety check: applyPlan is a POST write action, must only be attempted ONCE!
    expect(callCount).toBe(1);
  });

  it('retries idempotent GET requests on 503 errors', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({
            ok: false,
            error: { code: 'mcp_unavailable', message: 'Server busy' },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
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
          },
        }),
      });
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      maxRetries: 2,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.getDashboard('2026-10-22');
    expect(result.events).toEqual([]);
    expect(callCount).toBe(2); // Retried once and succeeded
  });
});
