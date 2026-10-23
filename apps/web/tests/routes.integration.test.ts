// @vitest-environment node
/**
 * Integration tests: the real built MCP server (dist/index.js, SQLite, Recovery Engine) is started as a
 * child process and the application's route handlers talk to it through the official MCP client over
 * Streamable HTTP. Nothing here is mocked.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiResponse, DashboardData } from '@/lib/api';
import type { ConflictAnalysis, RecoveryPlanSet, ValidationResult } from '@/lib/contract';
import { GET as dashboardGET } from '@/app/api/dashboard/route';
import { POST as analyzePOST } from '@/app/api/recovery/analyze/route';
import { POST as proposePOST } from '@/app/api/recovery/propose/route';
import { POST as validatePOST } from '@/app/api/recovery/validate/route';
import { startServer, type ServerHandle } from '../../../tests/helpers/serverProcess';

let server: ServerHandle;
let before: string;

/** Fingerprint of every table, read through a separate read-only connection. */
function fingerprint(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>;
    const dump = tables.map((t) => [t.name, db.prepare(`select * from "${t.name}" order by 1`).all()]);
    return createHash('sha256').update(JSON.stringify(dump)).digest('hex');
  } finally {
    db.close();
  }
}

const post = (handler: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  handler(new Request('http://localhost/api', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

async function json<T>(res: Response): Promise<ApiResponse<T>> {
  return (await res.json()) as ApiResponse<T>;
}

const scenario = {
  startTime: '2026-10-22T08:00:00+05:30',
  endTime: '2026-10-22T20:00:00+05:30',
  disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
  protectedEventIds: ['evt-005'],
};

beforeAll(async () => {
  server = await startServer();
  if (!server.databasePath) throw new Error('These tests need to own the server so they can inspect its database.');
  process.env.PLANRESCUE_MCP_URL = server.url;
  process.env.PLANRESCUE_MCP_TIMEOUT_MS = '5000';
  before = fingerprint(server.databasePath);
});

afterAll(async () => {
  delete process.env.PLANRESCUE_MCP_URL;
  delete process.env.PLANRESCUE_MCP_TIMEOUT_MS;
  await server.stop();
});

describe('GET /api/dashboard', () => {
  it('returns the seeded events and tasks fetched through get_schedule and get_tasks', async () => {
    const res = await dashboardGET(new Request('http://localhost/api/dashboard'));
    expect(res.status).toBe(200);
    const body = await json<DashboardData>(res);
    if (!body.ok) throw new Error('expected success');
    expect(body.data.events.map((e) => e.id)).toEqual(['evt-001', 'evt-002', 'evt-003', 'evt-004', 'evt-005', 'evt-006']);
    expect(body.data.tasks.map((t) => t.id)).toEqual(['task-004', 'task-002', 'task-003', 'task-001', 'task-005']);
    expect(body.data.calendarTimeZone).toBe('Asia/Kolkata');
    expect(body.data.utcOffset).toBe('+05:30');
    expect(body.activity.map((a) => [a.tool, a.status])).toEqual([
      ['get_schedule', 'success'],
      ['get_tasks', 'success'],
      ['analyze_conflicts', 'success'],
    ]);
    expect(body.data.baseline?.analysis.existingConflicts).toEqual([]);
    // The server really logged these calls.
    expect(server.logs()).toMatch(/Tool: get_schedule/);
    expect(server.logs()).toMatch(/Tool: get_tasks/);
  });

  it('returns an empty list (not an error) for a day with nothing scheduled', async () => {
    const res = await dashboardGET(new Request('http://localhost/api/dashboard?date=2026-12-25'));
    const body = await json<DashboardData>(res);
    if (!body.ok) throw new Error('expected success');
    expect(body.data.events).toEqual([]);
    expect(body.data.tasks).toEqual([]);
  });

  it('rejects a malformed or unreal date', async () => {
    expect((await dashboardGET(new Request('http://localhost/api/dashboard?date=tomorrow'))).status).toBe(400);
    expect((await dashboardGET(new Request('http://localhost/api/dashboard?date=2026-02-30'))).status).toBe(400);
  });
});

describe('recovery routes', () => {
  it('analyze_conflicts: the 40-minute meeting overrun collides with lunch, and the doctor stays protected', async () => {
    const res = await post(analyzePOST, scenario);
    const body = await json<ConflictAnalysis>(res);
    if (!body.ok) throw new Error(JSON.stringify(body.error));
    expect(body.activity).toHaveLength(1);
    expect(body.activity[0]).toMatchObject({ tool: 'analyze_conflicts', status: 'success' });
    expect(body.data.newConflicts).toHaveLength(1);
    expect(body.data.newConflicts[0]!.description).toMatch(/Lunch Break/);
    expect(body.data.existingConflicts).toEqual([]);
    expect(body.data.protectedConstraints.map((p) => p.eventId)).toContain('evt-005');
    expect(body.data.assessment.status).toBe('conflicts_resolvable');
  });

  it('propose_recovery_plan: returns ranked, validated candidates that leave protected events alone', async () => {
    const res = await post(proposePOST, { ...scenario, preferences: { optimizeFor: 'minimal_disruption' } });
    const body = await json<RecoveryPlanSet>(res);
    if (!body.ok) throw new Error(JSON.stringify(body.error));
    expect(body.data.outcome).toBe('plans_found');
    expect(body.data.candidates.length).toBeGreaterThan(0);
    const ranks = body.data.candidates.map((c) => c.score.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const c of body.data.candidates) {
      expect(c.validation.isValid).toBe(true);
      expect(c.changes.map((x) => x.eventId)).not.toContain('evt-005');
      expect(c.unchangedProtectedEvents.map((p) => p.eventId)).toContain('evt-005');
      for (const ch of c.changes) expect(Date.parse(ch.proposedEndTime) - Date.parse(ch.proposedStartTime)).toBe(Date.parse(ch.originalEndTime) - Date.parse(ch.originalStartTime));
    }
  });

  it('validate_recovery_plan: a candidate passed back unchanged is verified; a tampered one is invalid, not an error', async () => {
    const proposed = await json<RecoveryPlanSet>(await post(proposePOST, scenario));
    if (!proposed.ok) throw new Error('propose failed');
    const candidate = proposed.data.candidates[0]!;

    const ok = await json<ValidationResult>(await post(validatePOST, candidate));
    if (!ok.ok) throw new Error(JSON.stringify(ok.error));
    expect(ok.data.isValid).toBe(true);
    expect(ok.data.violations).toEqual([]);
    expect(ok.activity[0]).toMatchObject({ tool: 'validate_recovery_plan', status: 'success', summary: 'Plan is valid' });

    const tampered = structuredClone(candidate) as typeof candidate & { validation: { isValid: boolean } };
    tampered.changes.push({ eventId: 'evt-005', title: "Doctor's Appointment", originalStartTime: '', originalEndTime: '', reason: '', proposedStartTime: '2026-10-22T17:00:00+05:30', proposedEndTime: '2026-10-22T18:00:00+05:30' });
    tampered.validation.isValid = true; // a false claim the validator must not trust
    const bad = await json<ValidationResult>(await post(validatePOST, tampered));
    if (!bad.ok) throw new Error(JSON.stringify(bad.error));
    expect(bad.data.isValid).toBe(false);
    expect(bad.data.violations.map((v) => v.check)).toEqual(expect.arrayContaining(['protected_events']));
    expect(bad.activity[0]).toMatchObject({ status: 'success' }); // the call worked; the plan is what is invalid
  });

  it('reports a scenario with no feasible plan clearly instead of inventing candidates', async () => {
    // Protecting lunch while the meeting overruns into it leaves nothing that may move.
    const res = await post(proposePOST, { ...scenario, protectedEventIds: ['evt-005', 'evt-002'] });
    const body = await json<RecoveryPlanSet>(res);
    if (!body.ok) throw new Error(JSON.stringify(body.error));
    expect(body.data.outcome).toBe('infeasible');
    expect(body.data.candidates).toEqual([]);
    expect(body.data.infeasibility?.summary).toBeTruthy();
  });

  it('surfaces a tool-level rejection as mcp_tool_error (422), distinct from an invalid plan', async () => {
    const res = await post(analyzePOST, { ...scenario, disruption: { type: 'event_overrun', eventId: 'no-such-event', overrunMinutes: 40 } });
    expect(res.status).toBe(422);
    const body = await json<never>(res);
    if (body.ok) throw new Error('expected failure');
    expect(body.error.code).toBe('mcp_tool_error');
    expect(body.error.message).toMatch(/no-such-event/);
    expect(body.activity[0]).toMatchObject({ tool: 'analyze_conflicts', status: 'error', errorCode: 'mcp_tool_error' });
  });
});

describe('input validation and limits', () => {
  it('returns field-keyed 400s without calling the server', async () => {
    const logsBefore = server.logs().length;
    const res = await post(analyzePOST, { ...scenario, disruption: { ...scenario.disruption, overrunMinutes: 500 } });
    expect(res.status).toBe(400);
    const body = await json<never>(res);
    if (body.ok) throw new Error('expected failure');
    expect(body.error.fields?.['disruption.overrunMinutes']).toMatch(/at most 240/);
    expect(body.activity).toEqual([]);
    expect(server.logs().length).toBe(logsBefore);
  });
  it('rejects timestamps without an offset, bad JSON, wrong content type and oversized bodies', async () => {
    expect((await post(analyzePOST, { ...scenario, startTime: '2026-10-22T08:00:00' })).status).toBe(400);
    expect((await post(analyzePOST, '{not json')).status).toBe(400);
    expect((await post(analyzePOST, scenario, { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await post(analyzePOST, { ...scenario, protectedEventIds: ['x'.repeat(40_000)] })).status).toBe(413);
  });
  it('does not let a request smuggle extra fields to the tool', async () => {
    expect((await post(analyzePOST, { ...scenario, toolName: 'delete_everything' })).status).toBe(400);
  });
});

describe('failure modes', () => {
  it('reports an unreachable MCP server as 503 without leaking details', async () => {
    const saved = process.env.PLANRESCUE_MCP_URL;
    process.env.PLANRESCUE_MCP_URL = 'http://127.0.0.1:1/mcp';
    try {
      const res = await dashboardGET(new Request('http://localhost/api/dashboard'));
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/mcp_unavailable/);
      expect(text).not.toMatch(/ECONNREFUSED|stack|127\.0\.0\.1:1/);
      const body = JSON.parse(text) as ApiResponse<never>;
      expect(body.activity.every((a) => a.status === 'error')).toBe(true);
    } finally {
      process.env.PLANRESCUE_MCP_URL = saved;
    }
  });
  it('reports a bad server configuration without echoing it', async () => {
    const saved = process.env.PLANRESCUE_MCP_URL;
    process.env.PLANRESCUE_MCP_URL = 'http://user:secret@127.0.0.1:3001/mcp';
    try {
      const res = await post(analyzePOST, scenario);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toMatch(/misconfigured/);
      expect(text).not.toMatch(/secret/);
    } finally {
      process.env.PLANRESCUE_MCP_URL = saved;
    }
  });
});

describe('read-only guarantee', () => {
  it('leaves every SQLite table exactly as it was after all of the above', () => {
    expect(fingerprint(server.databasePath!)).toBe(before);
  });
});
