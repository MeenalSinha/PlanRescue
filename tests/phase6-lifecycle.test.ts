import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import Database from 'better-sqlite3';
import { startServer, type ServerHandle } from './helpers/serverProcess.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

describe('Phase 6 Lifecycle MCP Tools: Save, Get, Approve, Reject, Apply, History', () => {
  let tmp: TempDatabase;
  let server: ServerHandle;
  let client: Client;

  beforeEach(async () => {
    tmp = makeTempDatabase();
    server = await startServer({ databasePath: tmp.path });
    client = new Client({ name: 'phase6-test-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
    tmp.cleanup();
  });

  async function generateCandidates() {
    const res = await client.callTool({
      name: 'propose_recovery_plan',
      arguments: {
        startTime: '2026-10-22T08:00:00+05:30',
        endTime: '2026-10-22T20:00:00+05:30',
        disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
        protectedEventIds: ['evt-005'],
      },
    });
    expect(res.isError).toBeFalsy();
    const data = res.structuredContent as { outcome: string; candidates: any[] };
    expect(data.outcome).toBe('plans_found');
    expect(data.candidates.length).toBeGreaterThan(0);
    return data.candidates;
  }

  it('saves proposed candidates and generates persistent IDs and history', async () => {
    const candidates = await generateCandidates();
    const saveRes = await client.callTool({
      name: 'save_recovery_plans',
      arguments: {
        requestId: 'req-test-1',
        plans: candidates,
      },
    });
    expect(saveRes.isError).toBeFalsy();
    const saved = saveRes.structuredContent as { requestId: string; plans: any[] };
    expect(saved.requestId).toBe('req-test-1');
    expect(saved.plans.length).toBe(candidates.length);
    expect(saved.plans[0].status).toBe('proposed');
    expect(saved.plans[0].id).toMatch(/^[0-9a-f-]{36}$/);

    // Retrieve via get_recovery_plans
    const getRes = await client.callTool({
      name: 'get_recovery_plans',
      arguments: { requestId: 'req-test-1' },
    });
    expect(getRes.isError).toBeFalsy();
    const retrieved = getRes.structuredContent as { count: number; plans: any[] };
    expect(retrieved.count).toBe(candidates.length);
    expect(retrieved.plans[0].id).toBe(saved.plans[0].id);

    // Check action history
    const histRes = await client.callTool({
      name: 'get_action_history',
      arguments: { recoveryPlanId: saved.plans[0].id },
    });
    expect(histRes.isError).toBeFalsy();
    const history = histRes.structuredContent as { count: number; entries: any[] };
    expect(history.count).toBe(1);
    expect(history.entries[0].actionType).toBe('plan_saved');
  });

  it('enforces idempotency on duplicate save_recovery_plans requests', async () => {
    const candidates = await generateCandidates();
    const save1 = await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-idempotent', plans: candidates },
    });
    const save2 = await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-idempotent', plans: candidates },
    });
    expect(save1.isError).toBeFalsy();
    expect(save2.isError).toBeFalsy();
    const data1 = save1.structuredContent as { plans: any[] };
    const data2 = save2.structuredContent as { plans: any[] };
    expect(data1.plans.map((p) => p.id)).toEqual(data2.plans.map((p) => p.id));
  });

  it('approves a proposed plan, recording timestamp and history without changing calendar', async () => {
    const candidates = await generateCandidates();
    const saveRes = (await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-approve', plans: [candidates[0]] },
    })).structuredContent as { plans: any[] };
    const planId = saveRes.plans[0].id;

    // Calendar check before
    const calBefore = (await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' },
    })).structuredContent as { events: any[] };

    // Approve
    const appRes = await client.callTool({
      name: 'approve_recovery_plan',
      arguments: { planId },
    });
    if (appRes.isError) {
      console.error('appRes Error:', JSON.stringify(appRes));
      console.error('Server logs:', server.logs());
    }
    expect(appRes.isError).toBeFalsy();
    const appData = appRes.structuredContent as { status: string; approvedAt: string };
    expect(appData.status).toBe('approved');
    expect(appData.approvedAt).toBeTruthy();

    // Calendar must remain completely unchanged
    const calAfter = (await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' },
    })).structuredContent as { events: any[] };
    expect(calAfter.events).toEqual(calBefore.events);

    // Duplicate approve is idempotent
    const appDup = await client.callTool({
      name: 'approve_recovery_plan',
      arguments: { planId },
    });
    expect(appDup.isError).toBeFalsy();
  });

  it('rejects a proposed plan and prevents subsequent application', async () => {
    const candidates = await generateCandidates();
    const saveRes = (await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-reject', plans: [candidates[0]] },
    })).structuredContent as { plans: any[] };
    const planId = saveRes.plans[0].id;

    const rejRes = await client.callTool({
      name: 'reject_recovery_plan',
      arguments: { planId, reason: 'User preferred not to reschedule' },
    });
    expect(rejRes.isError).toBeFalsy();
    const rejData = rejRes.structuredContent as { status: string; rejectedAt: string };
    expect(rejData.status).toBe('rejected');

    // Attempting to apply a rejected plan fails
    const applyRes = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId },
    });
    expect(applyRes.isError).toBe(true);
    expect(JSON.stringify(applyRes)).toContain('rejected');
  });

  it('cannot apply an unapproved proposed plan', async () => {
    const candidates = await generateCandidates();
    const saveRes = (await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-unapproved', plans: [candidates[0]] },
    })).structuredContent as { plans: any[] };
    const planId = saveRes.plans[0].id;

    const applyRes = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId },
    });
    expect(applyRes.isError).toBe(true);
    expect(JSON.stringify(applyRes)).toContain('proposed');
  });

  it('atomically updates calendar when applying an approved plan', async () => {
    const candidates = await generateCandidates();
    const candidate = candidates[0];
    const saveRes = (await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-apply', plans: [candidate] },
    })).structuredContent as { plans: any[] };
    const planId = saveRes.plans[0].id;

    // Approve
    await client.callTool({
      name: 'approve_recovery_plan',
      arguments: { planId },
    });

    // Apply
    const applyRes = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId },
    });
    expect(applyRes.isError).toBeFalsy();
    const applyData = applyRes.structuredContent as { status: string; appliedAt: string; changes: any[] };
    expect(applyData.status).toBe('applied');
    expect(applyData.appliedAt).toBeTruthy();
    expect(applyData.changes.length).toBe(candidate.changes.length);

    // Verify schedule in database was actually updated
    const cal = (await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' },
    })).structuredContent as { events: Array<{ id: string; startTime: string; endTime: string }> };

    for (const change of candidate.changes) {
      const updatedEvt = cal.events.find((e) => e.id === change.eventId);
      expect(updatedEvt).toBeDefined();
      expect(updatedEvt!.startTime).toBe(change.proposedStartTime);
      expect(updatedEvt!.endTime).toBe(change.proposedEndTime);
    }

    // Repeated apply is idempotent
    const applyDup = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId },
    });
    expect(applyDup.isError).toBeFalsy();
    expect((applyDup.structuredContent as any).status).toBe('applied');
    expect((applyDup.structuredContent as any).message).toMatch(/already applied/);
  });

  it('detects stale plan when underlying schedule changes before application', async () => {
    const candidates = await generateCandidates();
    const candidate = candidates[0];
    const saveRes = (await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-stale', plans: [candidate] },
    })).structuredContent as { plans: any[] };
    const planId = saveRes.plans[0].id;

    // Approve
    await client.callTool({
      name: 'approve_recovery_plan',
      arguments: { planId },
    });

    // Mutate an event in SQLite directly to cause fingerprint mismatch
    const db = new Database(tmp.path);
    try {
      db.prepare("UPDATE calendar_events SET start_time = '2026-10-22T12:00:00+05:30' WHERE id = 'evt-002'").run();
    } finally {
      db.close();
    }

    // Apply must detect stale and reject
    const applyRes = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId },
    });
    expect(applyRes.isError).toBe(true);
    expect(JSON.stringify(applyRes)).toContain('stale');

    // Verify plan is marked stale in get_recovery_plans
    const getRes = (await client.callTool({
      name: 'get_recovery_plans',
      arguments: { id: planId },
    })).structuredContent as { plans: any[] };
    expect(getRes.plans[0].status).toBe('stale');
  });

  it('preserves saved plans and action history across server restart', async () => {
    const candidates = await generateCandidates();
    const saveRes = (await client.callTool({
      name: 'save_recovery_plans',
      arguments: { requestId: 'req-restart', plans: [candidates[0]] },
    })).structuredContent as { plans: any[] };
    const planId = saveRes.plans[0].id;

    await client.callTool({
      name: 'approve_recovery_plan',
      arguments: { planId },
    });

    // Disconnect and restart server
    await client.close();
    await server.stop();

    const restarted = await startServer({ databasePath: tmp.path });
    const client2 = new Client({ name: 'phase6-restart-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await client2.connect(new StreamableHTTPClientTransport(new URL(restarted.url)));

    try {
      const getRes = (await client2.callTool({
        name: 'get_recovery_plans',
        arguments: { id: planId },
      })).structuredContent as { plans: any[] };
      expect(getRes.plans[0].status).toBe('approved');

      const histRes = (await client2.callTool({
        name: 'get_action_history',
        arguments: { recoveryPlanId: planId },
      })).structuredContent as { count: number; entries: any[] };
      expect(histRes.count).toBe(2); // plan_saved, plan_approved
    } finally {
      await client2.close();
      await restarted.stop();
    }
  });
});
