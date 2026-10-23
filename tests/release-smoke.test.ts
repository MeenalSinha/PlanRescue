import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import Database from 'better-sqlite3';
import { startServer, type ServerHandle } from './helpers/serverProcess.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';

describe('Phase 7 Release Smoke Test: Complete Verified End-to-End Workflow', () => {
  let tmp: TempDatabase;
  let server: ServerHandle;
  let client: Client;

  beforeAll(async () => {
    // 1. Fresh isolated database
    tmp = makeTempDatabase();
    // 2. Start MCP server
    server = await startServer({ databasePath: tmp.path });
    // 3. Connect MCP client
    client = new Client(
      { name: 'release-smoke-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
    tmp?.cleanup();
  });

  it('executes full primary workflow: retrieve -> analyze -> propose -> validate -> save -> approve -> apply -> audit -> restart -> idempotent re-apply', async () => {
    // Step 4: Retrieve schedule and tasks
    const schedRes = await client.callTool({
      name: 'get_schedule',
      arguments: {
        startTime: '2026-10-22T08:00:00+05:30',
        endTime: '2026-10-22T20:00:00+05:30',
      },
    });
    expect(schedRes.isError).toBeFalsy();
    const schedData = schedRes.structuredContent as { count: number; events: any[] };
    expect(schedData.count).toBe(6);

    const taskRes = await client.callTool({
      name: 'get_tasks',
      arguments: {},
    });
    expect(taskRes.isError).toBeFalsy();
    const taskData = taskRes.structuredContent as { count: number; tasks: any[] };
    expect(taskData.count).toBe(5);

    // Initial event times snapshot
    const initialEvents = schedData.events;
    const teamMeeting = initialEvents.find((e) => e.id === 'evt-001')!;
    const doctorAppt = initialEvents.find((e) => e.id === 'evt-005')!;
    expect(teamMeeting.startTime).toBe('2026-10-22T11:30:00+05:30');
    expect(doctorAppt.startTime).toBe('2026-10-22T16:30:00+05:30');

    // Step 5: Analyze disruption (Team Meeting 40 min overrun, Doctor's appointment protected)
    const analyzeRes = await client.callTool({
      name: 'analyze_conflicts',
      arguments: {
        startTime: '2026-10-22T08:00:00+05:30',
        endTime: '2026-10-22T20:00:00+05:30',
        disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
        protectedEventIds: ['evt-005'],
      },
    });
    expect(analyzeRes.isError).toBeFalsy();
    const analyzeData = analyzeRes.structuredContent as { newConflicts: any[]; existingConflicts: any[] };
    expect(analyzeData.newConflicts.length).toBe(1);
    expect(analyzeData.existingConflicts.length).toBe(0);

    // Step 6: Generate recovery-plan candidates
    const proposeRes = await client.callTool({
      name: 'propose_recovery_plan',
      arguments: {
        startTime: '2026-10-22T08:00:00+05:30',
        endTime: '2026-10-22T20:00:00+05:30',
        disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
        protectedEventIds: ['evt-005'],
        preferences: { optimizeFor: 'minimal_disruption' },
      },
    });
    expect(proposeRes.isError).toBeFalsy();
    const proposeData = proposeRes.structuredContent as { outcome: string; candidates: any[] };
    expect(proposeData.outcome).toBe('plans_found');
    expect(proposeData.candidates.length).toBeGreaterThan(0);

    const recommendedPlan = proposeData.candidates[0]!;
    // Confirm doctor's appointment is preserved and unchanged
    const doctorInPlan = recommendedPlan.unchangedProtectedEvents.find((p: any) => p.eventId === 'evt-005');
    expect(doctorInPlan).toBeDefined();

    // Step 7: Independently validate recommended candidate
    const validateRes = await client.callTool({
      name: 'validate_recovery_plan',
      arguments: recommendedPlan,
    });
    expect(validateRes.isError).toBeFalsy();
    const validateData = validateRes.structuredContent as { isValid: boolean; violations: any[] };
    expect(validateData.isValid).toBe(true);
    expect(validateData.violations).toHaveLength(0);

    // Step 8: Persist eligible candidates
    const saveRes = await client.callTool({
      name: 'save_recovery_plans',
      arguments: {
        requestId: 'release-smoke-req-1',
        plans: [recommendedPlan],
      },
    });
    expect(saveRes.isError).toBeFalsy();
    const saveData = saveRes.structuredContent as { plans: any[] };
    expect(saveData.plans).toHaveLength(1);
    const persistentPlanId = saveData.plans[0].id;
    expect(persistentPlanId).toMatch(/^[0-9a-f-]{36}$/);

    // Step 9 & 10: Explicit approval & verify calendar remains UNCHANGED
    const rawDb = new Database(tmp.path);
    const eventsBeforeApprove = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();

    const approveRes = await client.callTool({
      name: 'approve_recovery_plan',
      arguments: { planId: persistentPlanId, actor: 'release-auditor' },
    });
    expect(approveRes.isError).toBeFalsy();
    const approveData = approveRes.structuredContent as { status: string; planId: string };
    expect(approveData.status).toBe('approved');

    // Calendar must still be untouched after approval!
    const eventsAfterApprove = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();
    expect(eventsAfterApprove).toEqual(eventsBeforeApprove);

    // Step 11: Apply approved plan
    const applyRes = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId: persistentPlanId, actor: 'release-auditor' },
    });
    expect(applyRes.isError).toBeFalsy();
    const applyData = applyRes.structuredContent as { status: string; changesCount: number; changes: any[] };
    expect(applyData.status).toBe('applied');
    expect(applyData.changesCount).toBeGreaterThan(0);

    // Step 12: Verify exact calendar changes in SQLite
    const eventsAfterApply = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all() as any[];
    expect(eventsAfterApply).not.toEqual(eventsBeforeApprove);

    // Doctor's appointment remained fixed
    const doctorAfter = eventsAfterApply.find((e) => e.id === 'evt-005')!;
    expect(doctorAfter.start_time).toBe('2026-10-22T16:30:00+05:30');

    // Rescheduled events reflect the candidate changes
    for (const change of applyData.changes) {
      const dbEvent = eventsAfterApply.find((e) => e.id === change.eventId)!;
      expect(dbEvent.start_time).toBe(change.newStartTime);
      expect(dbEvent.end_time).toBe(change.newEndTime);
    }

    // Step 13: Verify persistent plan status
    const planRow = rawDb.prepare('SELECT * FROM recovery_plans WHERE id = ?').get(persistentPlanId) as any;
    expect(planRow.status).toBe('applied');
    expect(planRow.applied_at).toBeTruthy();

    // Step 14: Verify action-history records
    const historyRows = rawDb
      .prepare('SELECT * FROM action_history WHERE recovery_plan_id = ? ORDER BY occurred_at ASC')
      .all(persistentPlanId) as any[];
    expect(historyRows.map((h) => h.action_type)).toEqual(['plan_saved', 'plan_approved', 'plan_applied']);
    rawDb.close();

    // Step 15: Restart the MCP server on the same database
    await client.close();
    await server.stop();

    server = await startServer({ databasePath: tmp.path });
    client = new Client(
      { name: 'release-smoke-client-2', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));

    // Step 16: Retrieve plan and history again after restart
    const getPlansAfterRestart = await client.callTool({
      name: 'get_recovery_plans',
      arguments: { planId: persistentPlanId },
    });
    expect(getPlansAfterRestart.isError).toBeFalsy();
    const plansAfterRestart = getPlansAfterRestart.structuredContent as { plans: any[] };
    expect(plansAfterRestart.plans[0].status).toBe('applied');
    expect(plansAfterRestart.plans[0].id).toBe(persistentPlanId);

    const getHistoryAfterRestart = await client.callTool({
      name: 'get_action_history',
      arguments: { recoveryPlanId: persistentPlanId },
    });
    expect(getHistoryAfterRestart.isError).toBeFalsy();
    const historyAfterRestart = getHistoryAfterRestart.structuredContent as { count: number; entries: any[] };
    expect(historyAfterRestart.count).toBe(3);

    // Step 17 & 18: Attempt repeated application -> confirm idempotency
    const reapplyRes = await client.callTool({
      name: 'apply_approved_plan',
      arguments: { planId: persistentPlanId },
    });
    expect(reapplyRes.isError).toBeFalsy();
    const reapplyData = reapplyRes.structuredContent as { status: string; message: string };
    expect(reapplyData.status).toBe('applied');
    expect(reapplyData.message).toMatch(/already applied/i);

    // Verify calendar events were not double-modified
    const rawDbAfterReapply = new Database(tmp.path);
    const eventsAfterReapply = rawDbAfterReapply
      .prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id')
      .all() as any[];
    expect(eventsAfterReapply).toEqual(eventsAfterApply);
    rawDbAfterReapply.close();
  });
});
