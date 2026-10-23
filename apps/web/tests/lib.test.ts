// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from '@/lib/env';
import { analyzeRequestSchema, fieldErrors, proposeRequestSchema, validateRequestSchema } from '@/lib/requests';
import { addDays, clock, dayWindow, describeMove, formatMinutes, isIsoWithOffset, isValidDate, offsetForZone, offsetOf, rangeLabel, withOffset } from '@/lib/time';
import { buildRequest, defaultForm } from '@/lib/useRecoveryApp';

describe('time helpers keep the calendar offset', () => {
  it('formats from the timestamp itself, not the viewer zone', () => {
    expect(clock('2026-10-22T13:30:00+05:30')).toBe('1:30 PM');
    expect(clock('2026-10-22T00:05:00-07:00')).toBe('12:05 AM');
    expect(offsetOf('2026-10-22T13:30:00+05:30')).toBe('+05:30');
    expect(offsetOf('2026-10-22T08:00:00Z')).toBe('+00:00');
    expect(rangeLabel('2026-10-22T13:30:00+05:30', '2026-10-22T14:30:00+05:30')).toBe('1:30 PM – 2:30 PM');
  });
  it('builds the day window for Asia/Kolkata', () => {
    expect(offsetForZone('2026-10-22', 'Asia/Kolkata')).toBe('+05:30');
    expect(dayWindow('2026-10-22', 'Asia/Kolkata')).toEqual({ startTime: '2026-10-22T00:00:00+05:30', endTime: '2026-10-23T00:00:00+05:30' });
    expect(offsetForZone('2026-07-01', 'America/New_York')).toBe('-04:00');
  });
  it('describes movement and durations', () => {
    expect(describeMove('2026-10-22T12:30:00+05:30', '2026-10-22T13:40:00+05:30')).toBe('1 h 10 min later');
    expect(describeMove('2026-10-22T12:30:00+05:30', '2026-10-22T12:30:00+05:30')).toBe('Start time unchanged');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
  });
  it('validates dates and timestamps', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-10-22')).toBe(true);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(isIsoWithOffset('2026-10-22T08:00:00')).toBe(false);
    expect(isIsoWithOffset('2026-10-22T08:00:00+05:30')).toBe(true);
    expect(withOffset('2026-10-22T08:00', '+05:30')).toBe('2026-10-22T08:00:00+05:30');
  });
});

describe('request schemas', () => {
  const base = {
    startTime: '2026-10-22T08:00:00+05:30',
    endTime: '2026-10-22T20:00:00+05:30',
    disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
  };
  it('accepts a correctly formatted scenario', () => {
    expect(analyzeRequestSchema.safeParse({ ...base, protectedEventIds: ['evt-005'] }).success).toBe(true);
    expect(proposeRequestSchema.safeParse({ ...base, preferences: { optimizeFor: 'transition_time' } }).success).toBe(true);
  });
  it('rejects a window that ends before it starts, or is longer than 14 days', () => {
    const inverted = analyzeRequestSchema.safeParse({ ...base, endTime: '2026-10-22T07:00:00+05:30' });
    expect(inverted.success).toBe(false);
    if (!inverted.success) expect(fieldErrors(inverted.error)['endTime']).toMatch(/after it starts/);
    expect(analyzeRequestSchema.safeParse({ ...base, endTime: '2026-11-22T08:00:00+05:30' }).success).toBe(false);
  });
  it('rejects timestamps without an offset', () => {
    expect(analyzeRequestSchema.safeParse({ ...base, startTime: '2026-10-22T08:00:00' }).success).toBe(false);
  });
  it('enforces the overrun limits', () => {
    for (const bad of [0, -5, 241, 1.5, '40']) {
      expect(analyzeRequestSchema.safeParse({ ...base, disruption: { ...base.disruption, overrunMinutes: bad } }).success).toBe(false);
    }
    for (const good of [1, 15, 40, 240]) {
      expect(analyzeRequestSchema.safeParse({ ...base, disruption: { ...base.disruption, overrunMinutes: good } }).success).toBe(true);
    }
  });
  it('rejects unsupported disruption types and unknown keys', () => {
    expect(analyzeRequestSchema.safeParse({ ...base, disruption: { type: 'cancellation', eventId: 'x', overrunMinutes: 5 } }).success).toBe(false);
    expect(analyzeRequestSchema.safeParse({ ...base, sql: 'drop table events' }).success).toBe(false);
  });
  it('lets a plan candidate carry extra fields through untouched', () => {
    const plan = { ...base, planId: 'p1', changes: [{ eventId: 'evt-002', extra: 1 }], score: { total: 1 }, validation: { isValid: true } };
    const parsed = validateRequestSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ score: { total: 1 }, validation: { isValid: true } });
  });
});

describe('form to request', () => {
  it('reports missing fields before any request is made', () => {
    const r = buildRequest(defaultForm('2026-10-22'), '+05:30');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors['disruption.eventId']).toBeDefined();
  });
  it('reports a non-numeric overrun', () => {
    const r = buildRequest({ ...defaultForm('2026-10-22'), eventId: 'evt-001', overrun: 'abc' }, '+05:30');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors['disruption.overrunMinutes']).toBeDefined();
  });
  it('reports an out-of-range overrun and an inverted window', () => {
    const tooLong = buildRequest({ ...defaultForm('2026-10-22'), eventId: 'evt-001', overrun: '500' }, '+05:30');
    expect(tooLong.ok).toBe(false);
    const inverted = buildRequest({ ...defaultForm('2026-10-22'), eventId: 'evt-001', startLocal: '2026-10-22T20:00', endLocal: '2026-10-22T08:00' }, '+05:30');
    expect(inverted.ok).toBe(false);
  });
  it('produces correctly formatted intervals for a valid scenario', () => {
    const r = buildRequest({ ...defaultForm('2026-10-22'), eventId: 'evt-001', overrun: '40', protectedIds: ['evt-005'] }, '+05:30');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.analyze.startTime).toBe('2026-10-22T08:00:00+05:30');
      expect(r.analyze.endTime).toBe('2026-10-22T20:00:00+05:30');
      expect(r.analyze.disruption).toEqual({ type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 });
      expect(r.analyze.protectedEventIds).toEqual(['evt-005']);
    }
  });
});

describe('server configuration', () => {
  it('uses documented defaults', () => {
    expect(loadServerConfig({})).toEqual({ mcpUrl: 'http://127.0.0.1:3001/mcp', timeoutMs: 10_000, calendarTimeZone: 'Asia/Kolkata' });
  });
  it('treats blank values as unset', () => {
    expect(loadServerConfig({ PLANRESCUE_MCP_URL: '  ', PLANRESCUE_MCP_TIMEOUT_MS: '' }).timeoutMs).toBe(10_000);
  });
  it('rejects unsafe or invalid settings', () => {
    expect(() => loadServerConfig({ PLANRESCUE_MCP_URL: 'ftp://127.0.0.1/mcp' })).toThrow(ConfigError);
    expect(() => loadServerConfig({ PLANRESCUE_MCP_URL: 'http://user:pw@127.0.0.1:3001/mcp' })).toThrow(/credentials/);
    expect(() => loadServerConfig({ PLANRESCUE_MCP_URL: 'http://example.com/mcp' })).toThrow(/loopback/);
    expect(() => loadServerConfig({ PLANRESCUE_MCP_URL: 'not a url' })).toThrow(ConfigError);
    expect(() => loadServerConfig({ PLANRESCUE_MCP_TIMEOUT_MS: '5' })).toThrow(ConfigError);
    expect(() => loadServerConfig({ PLANRESCUE_CALENDAR_TIME_ZONE: 'Mars/Base' })).toThrow(/time zone/);
  });
  it('allows a remote server only when explicitly enabled', () => {
    expect(loadServerConfig({ PLANRESCUE_MCP_URL: 'https://mcp.example.com/mcp', PLANRESCUE_ALLOW_REMOTE_MCP: 'true' }).mcpUrl).toBe('https://mcp.example.com/mcp');
  });
});
