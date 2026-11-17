import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/healthz/route';

describe('Spatial Phase 14: Health Probe Verification (/api/healthz)', () => {
  it('returns status alive on liveness probe', async () => {
    const req = new Request('http://localhost:3000/api/healthz?probe=liveness');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('alive');
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.data.timestamp).toBeDefined();
    expect(body.data.version).toBe('0.1.0');
  });

  it('returns status ready with database and WAL checks on readiness probe', async () => {
    const req = new Request('http://localhost:3000/api/healthz?probe=readiness');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ready');
    expect(body.data.checks.database).toBe('ready');
    expect(body.data.checks.walMode).toBe('wal');
    expect(body.data.checks.mcpConfig).toBe('ok');
  });
});
