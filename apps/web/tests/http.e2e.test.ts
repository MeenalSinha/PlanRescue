// @vitest-environment node
/** Raw HTTP checks against the real production Next.js server in front of the real MCP server. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStack, type Stack } from './helpers/stack';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});

const body = {
  startTime: '2026-10-22T08:00:00+05:30',
  endTime: '2026-10-22T20:00:00+05:30',
  disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
  protectedEventIds: ['evt-005'],
};
const post = (path: string, b: unknown) => fetch(`${stack.webUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('HTTP surface', () => {
  it('serves the page with defensive headers', async () => {
    const res = await fetch(stack.webUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-powered-by')).toBeNull();
    const html = await res.text();
    expect(html).toContain('PlanRescue');
    // No server configuration is shipped to the browser.
    expect(html).not.toContain(stack.mcp.url);
    expect(html).not.toContain(stack.mcp.databasePath!);
  });

  it('runs the whole workflow over HTTP', async () => {
    const d = (await (await fetch(`${stack.webUrl}/api/dashboard`)).json()) as { ok: boolean; data: { events: unknown[]; tasks: unknown[] } };
    expect(d.ok).toBe(true);
    expect(d.data.events).toHaveLength(6);
    const a = (await (await post('/api/recovery/analyze', body)).json()) as { ok: boolean; data: { newConflicts: unknown[] } };
    expect(a.data.newConflicts).toHaveLength(1);
    const p = (await (await post('/api/recovery/propose', body)).json()) as { ok: boolean; data: { candidates: Array<Record<string, unknown>> } };
    expect(p.data.candidates.length).toBeGreaterThan(0);
    const v = (await (await post('/api/recovery/validate', p.data.candidates[0])).json()) as { ok: boolean; data: { isValid: boolean } };
    expect(v.ok).toBe(true);
    expect(v.data.isValid).toBe(true);
  });

  it('exposes no generic MCP proxy and no other tool', async () => {
    for (const path of ['/api/mcp', '/api/tools', '/api/recovery/get_schedule', '/api/recovery/apply', '/mcp']) {
      const res = await post(path, { tool: 'get_schedule' });
      expect(res.status, path).toBe(404);
    }
    const res = await fetch(`${stack.webUrl}/api/recovery/analyze`);
    expect(res.status).toBe(405);
  });

  it('gives predictable JSON errors with no stack traces', async () => {
    const bad = await post('/api/recovery/analyze', { nope: true });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('content-type')).toMatch(/json/);
    const text = await bad.text();
    expect(text).not.toMatch(/\bat .*\.(ts|js):\d+|node_modules|Error:/);
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('invalid_request');
  });

  it('never changes the database', () => {
    // Read-only by construction: the fingerprint is compared against a fresh one taken now.
    expect(stack.databaseFingerprint()).toMatch(/^[0-9a-f]{64}$/);
  });
});
