import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { startServer, type ServerHandle } from './helpers/serverProcess.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';
import { SqliteRecoveryPlanRepository } from '../apps/mcp-server/src/data/sqliteRecoveryPlanRepository.js';
import { SqliteScheduleRepository } from '../apps/mcp-server/src/data/sqliteScheduleRepository.js';
import { SqliteTaskRepository } from '../apps/mcp-server/src/data/sqliteTaskRepository.js';
import { SqliteActionHistoryRepository } from '../apps/mcp-server/src/data/sqliteActionHistoryRepository.js';
import { createLogger } from '../apps/mcp-server/src/logger.js';
import { computeSnapshotHash } from '../apps/mcp-server/src/data/snapshotHash.js';

describe('Phase 7: Comprehensive Hardening, Reliability & Transactional Integrity', () => {
  let tmp: TempDatabase;
  let server: ServerHandle;
  let client: Client;

  beforeEach(async () => {
    tmp = makeTempDatabase();
    server = await startServer({ databasePath: tmp.path });
    client = new Client(
      { name: 'phase7-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
    tmp.cleanup();
  });

  async function proposeAndSavePlan(requestId = randomUUID()) {
    const proposeRes = await client.callTool({
      name: 'propose_recovery_plan',
      arguments: {
        startTime: '2026-10-22T08:00:00+05:30',
        endTime: '2026-10-22T20:00:00+05:30',
        disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
        protectedEventIds: ['evt-005'],
      },
    });
    expect(proposeRes.isError).toBeFalsy();
    const data = proposeRes.structuredContent as { outcome: string; candidates: any[] };
    expect(data.outcome).toBe('plans_found');
    expect(data.candidates.length).toBeGreaterThan(0);

    const saveRes = await client.callTool({
      name: 'save_recovery_plans',
      arguments: {
        requestId,
        plans: [data.candidates[0]],
      },
    });
    expect(saveRes.isError).toBeFalsy();
    const saved = saveRes.structuredContent as { plans: any[] };
    return { planId: saved.plans[0].id, candidate: data.candidates[0] };
  }

  describe('Part D: Transaction Atomicity & Fault-Injection Rollback', () => {
    it('rolls back calendar changes and preserves approved status if mid-transaction failure occurs', async () => {
      const { planId, candidate } = await proposeAndSavePlan();

      // Approve plan
      const approveRes = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });
      expect(approveRes.isError).toBeFalsy();

      // Direct DB inspection
      const rawDb = new Database(tmp.path);
      const planBefore = rawDb.prepare('SELECT * FROM recovery_plans WHERE id = ?').get(planId) as any;
      expect(planBefore.status).toBe('approved');

      const eventsBefore = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();

      // Test repository-level atomic transaction with fault injection
      const planRepo = new SqliteRecoveryPlanRepository(rawDb);

      // Fault injection: update has 1 valid event move and 1 invalid event move (nonexistent event id)
      const updatesWithFault = [
        {
          eventId: candidate.changes[0].eventId,
          originalStartTime: candidate.changes[0].originalStartTime,
          originalEndTime: candidate.changes[0].originalEndTime,
          proposedStartTime: candidate.changes[0].proposedStartTime,
          proposedEndTime: candidate.changes[0].proposedEndTime,
        },
        {
          eventId: 'evt-nonexistent-synthetic',
          originalStartTime: '2026-10-22T14:00:00+05:30',
          originalEndTime: '2026-10-22T15:00:00+05:30',
          proposedStartTime: '2026-10-22T14:30:00+05:30',
          proposedEndTime: '2026-10-22T15:30:00+05:30',
        },
      ];

      // Attempt application with fault
      await expect(
        planRepo.applyApprovedPlanAtomically({
          planId,
          actor: 'fault-injector',
          updates: updatesWithFault,
          historyDetailsJson: JSON.stringify({ injected: true }),
        }),
      ).rejects.toThrow();

      // VERIFY: The first event was rolled back! No partial writes in SQLite!
      const eventsAfter = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();
      expect(eventsAfter).toEqual(eventsBefore);

      // VERIFY: Plan status remains 'approved', not 'applied'
      const planAfter = rawDb.prepare('SELECT * FROM recovery_plans WHERE id = ?').get(planId) as any;
      expect(planAfter.status).toBe('approved');
      expect(planAfter.applied_at).toBeNull();

      // VERIFY: No 'plan_applied' history entry was written
      const appliedHistory = rawDb
        .prepare('SELECT * FROM action_history WHERE recovery_plan_id = ? AND action_type = ?')
        .all(planId, 'plan_applied');
      expect(appliedHistory).toHaveLength(0);

      rawDb.close();
    });

    it('rolls back calendar changes if plan status update constraint fails', async () => {
      const { planId, candidate } = await proposeAndSavePlan();

      const rawDb = new Database(tmp.path);
      // Leave plan in 'proposed' status (not approved)
      const planBefore = rawDb.prepare('SELECT * FROM recovery_plans WHERE id = ?').get(planId) as any;
      expect(planBefore.status).toBe('proposed');

      const eventsBefore = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();
      const planRepo = new SqliteRecoveryPlanRepository(rawDb);

      const updates = candidate.changes.map((c: any) => ({
        eventId: c.eventId,
        originalStartTime: c.originalStartTime,
        originalEndTime: c.originalEndTime,
        proposedStartTime: c.proposedStartTime,
        proposedEndTime: c.proposedEndTime,
      }));

      // Attempt atomic application on unapproved plan
      await expect(
        planRepo.applyApprovedPlanAtomically({
          planId,
          actor: 'tester',
          updates,
          historyDetailsJson: JSON.stringify({}),
        }),
      ).rejects.toThrow(/status is "proposed"/);

      // Verify zero calendar events changed
      const eventsAfter = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();
      expect(eventsAfter).toEqual(eventsBefore);

      rawDb.close();
    });
  });

  describe('Part D: Stale-Plan Detection Across Events and Tasks', () => {
    it('detects stale plan when a task deadline or duration changes', async () => {
      const { planId } = await proposeAndSavePlan();

      // Approve plan
      const approveRes = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });
      expect(approveRes.isError).toBeFalsy();

      // Directly modify a task record in SQLite
      const rawDb = new Database(tmp.path);
      rawDb.prepare('UPDATE tasks SET estimated_duration_minutes = estimated_duration_minutes + 30 WHERE id = ?').run('task-001');
      rawDb.close();

      // Attempt to apply the plan
      const applyRes = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(applyRes.isError).toBe(true);
      const text = (applyRes.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/the underlying calendar or tasks changed/i);

      // Check plan transitioned to 'stale'
      const getRes = await client.callTool({
        name: 'get_recovery_plans',
        arguments: { planId },
      });
      const data = getRes.structuredContent as { plans: any[] };
      expect(data.plans[0].status).toBe('stale');

      // Verify 'plan_stale' action history entry
      const histRes = await client.callTool({
        name: 'get_action_history',
        arguments: { recoveryPlanId: planId },
      });
      const histData = histRes.structuredContent as { entries: any[] };
      expect(histData.entries.some((e) => e.actionType === 'plan_stale')).toBe(true);
    });

    it('detects stale plan during approval if an event was modified after proposal', async () => {
      const { planId } = await proposeAndSavePlan();

      // Directly modify a calendar event in SQLite before approval
      const rawDb = new Database(tmp.path);
      rawDb
        .prepare('UPDATE calendar_events SET title = ? WHERE id = ?')
        .run('Modified Title', 'evt-002');
      rawDb.close();

      // Attempt to approve
      const approveRes = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });
      expect(approveRes.isError).toBe(true);
      const text = (approveRes.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/underlying schedule or tasks changed/i);

      // Check plan status transitioned to stale
      const getRes = await client.callTool({
        name: 'get_recovery_plans',
        arguments: { planId },
      });
      const data = getRes.structuredContent as { plans: any[] };
      expect(data.plans[0].status).toBe('stale');
    });
  });

  describe('Part D: State Machine Validation & Transition Rejections', () => {
    it('rejects invalid state transitions: cannot approve rejected or applied plans', async () => {
      const { planId } = await proposeAndSavePlan();

      // Reject the plan
      const rejectRes = await client.callTool({
        name: 'reject_recovery_plan',
        arguments: { planId, reason: 'Testing invalid transition' },
      });
      expect(rejectRes.isError).toBeFalsy();

      // Attempt to approve rejected plan -> must fail
      const approveRes = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });
      expect(approveRes.isError).toBe(true);
      const text = (approveRes.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/Cannot approve recovery plan .* status "rejected"/i);

      // Attempt to apply rejected plan -> must fail
      const applyRes = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(applyRes.isError).toBe(true);
    });

    it('rejects applying an unapproved proposed plan', async () => {
      const { planId } = await proposeAndSavePlan();

      const applyRes = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(applyRes.isError).toBe(true);
      const text = (applyRes.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/status is "proposed". Only approved plans can be applied/i);
    });

    it('allows cancelling approval of an approved plan before application', async () => {
      const { planId } = await proposeAndSavePlan();

      // Approve plan
      const approveRes = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });
      expect(approveRes.isError).toBeFalsy();

      // Cancel approval via reject
      const rejectRes = await client.callTool({
        name: 'reject_recovery_plan',
        arguments: { planId, reason: 'User changed mind' },
      });
      expect(rejectRes.isError).toBeFalsy();

      // Action history should record approval_cancelled
      const histRes = await client.callTool({
        name: 'get_action_history',
        arguments: { recoveryPlanId: planId },
      });
      const histData = histRes.structuredContent as { entries: any[] };
      expect(histData.entries.some((e) => e.actionType === 'approval_cancelled')).toBe(true);

      // Cannot apply after cancellation
      const applyRes = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(applyRes.isError).toBe(true);
    });

    it('cannot reject an already applied plan', async () => {
      const { planId } = await proposeAndSavePlan();

      await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });

      const applyRes = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(applyRes.isError).toBeFalsy();

      const rejectRes = await client.callTool({
        name: 'reject_recovery_plan',
        arguments: { planId },
      });
      expect(rejectRes.isError).toBe(true);
      const text = (rejectRes.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/already been applied/i);
    });
  });

  describe('Part D: Idempotency & Concurrency', () => {
    it('handles repeated approvals idempotently without creating duplicate history', async () => {
      const { planId } = await proposeAndSavePlan();

      const app1 = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });
      const app2 = await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });

      expect(app1.isError).toBeFalsy();
      expect(app2.isError).toBeFalsy();

      const data1 = app1.structuredContent as any;
      const data2 = app2.structuredContent as any;
      expect(data1.status).toBe('approved');
      expect(data2.status).toBe('approved');

      // Check action history: only 1 plan_approved entry
      const histRes = await client.callTool({
        name: 'get_action_history',
        arguments: { recoveryPlanId: planId, actionType: 'plan_approved' },
      });
      const histData = histRes.structuredContent as { count: number };
      expect(histData.count).toBe(1);
    });

    it('handles repeated rejections idempotently', async () => {
      const { planId } = await proposeAndSavePlan();

      const rej1 = await client.callTool({
        name: 'reject_recovery_plan',
        arguments: { planId },
      });
      const rej2 = await client.callTool({
        name: 'reject_recovery_plan',
        arguments: { planId },
      });

      expect(rej1.isError).toBeFalsy();
      expect(rej2.isError).toBeFalsy();

      const data1 = rej1.structuredContent as any;
      const data2 = rej2.structuredContent as any;
      expect(data1.status).toBe('rejected');
      expect(data2.status).toBe('rejected');
    });

    it('handles repeated applications idempotently without modifying calendar twice', async () => {
      const { planId } = await proposeAndSavePlan();

      await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });

      const apply1 = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(apply1.isError).toBeFalsy();

      const rawDb = new Database(tmp.path);
      const eventsAfterApply1 = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();

      const apply2 = await client.callTool({
        name: 'apply_approved_plan',
        arguments: { planId },
      });
      expect(apply2.isError).toBeFalsy();

      const eventsAfterApply2 = rawDb.prepare('SELECT id, start_time, end_time FROM calendar_events ORDER BY id').all();
      expect(eventsAfterApply2).toEqual(eventsAfterApply1);
      rawDb.close();
    });

    it('safely handles concurrent application requests', async () => {
      const { planId } = await proposeAndSavePlan();

      await client.callTool({
        name: 'approve_recovery_plan',
        arguments: { planId },
      });

      // Spawn 2 parallel apply requests
      const [res1, res2] = await Promise.all([
        client.callTool({ name: 'apply_approved_plan', arguments: { planId } }),
        client.callTool({ name: 'apply_approved_plan', arguments: { planId } }),
      ]);

      expect(res1.isError).toBeFalsy();
      expect(res2.isError).toBeFalsy();

      const d1 = res1.structuredContent as any;
      const d2 = res2.structuredContent as any;
      expect(d1.status).toBe('applied');
      expect(d2.status).toBe('applied');

      // Verify SQLite state: exactly 1 plan_applied entry
      const rawDb = new Database(tmp.path);
      const historyRows = rawDb
        .prepare('SELECT * FROM action_history WHERE recovery_plan_id = ? AND action_type = ?')
        .all(planId, 'plan_applied');
      expect(historyRows).toHaveLength(1);
      rawDb.close();
    });
  });
});
