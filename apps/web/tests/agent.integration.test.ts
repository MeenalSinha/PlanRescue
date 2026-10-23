// @vitest-environment node
/**
 * Phase 5 Integration Test: AI Agent against the REAL MCP server.
 *
 * Starts the real built MCP server (dist/index.js, SQLite, Recovery Engine)
 * as a child process with Streamable HTTP transport.
 * Uses an injectable LLM provider so inference is deterministic and does not
 * require live cloud credentials, while the MCP server and tool executions remain 100% real.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider } from '@/lib/agent/provider';
import { runAgentTurn } from '@/lib/agent/orchestrator';
import { POST as agentTurnPOST } from '@/app/api/agent/turn/route';
import { startServer, type ServerHandle } from '../../../tests/helpers/serverProcess';

let server: ServerHandle;
let beforeDbFingerprint: string;

function fingerprint(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as Array<{ name: string }>;
    const dump = tables.map((t) => [t.name, db.prepare(`select * from "${t.name}" order by 1`).all()]);
    return createHash('sha256').update(JSON.stringify(dump)).digest('hex');
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  server = await startServer();
  if (!server.databasePath) throw new Error('Integration test needs to own the server to inspect its database.');
  process.env.PLANRESCUE_MCP_URL = server.url;
  process.env.PLANRESCUE_MCP_TIMEOUT_MS = '8000';
  beforeDbFingerprint = fingerprint(server.databasePath);
});

afterAll(async () => {
  delete process.env.PLANRESCUE_MCP_URL;
  delete process.env.PLANRESCUE_MCP_TIMEOUT_MS;
  await server.stop();
});

describe('AI Agent Integration against real MCP Server over Streamable HTTP', () => {
  it('executes full natural-language recovery workflow through genuine MCP tools', async () => {
    const mockProvider: LlmProvider = {
      extractIntent: async (_msg, context) => {
        // Confirm real events were retrieved from SQLite and passed to grounding context
        expect(context.events.length).toBeGreaterThanOrEqual(4);
        expect(context.tasks.length).toBeGreaterThanOrEqual(2);
        const teamMeeting = context.events.find((e) => e.title.includes('Team Meeting'));
        expect(teamMeeting).toBeDefined();

        return {
          status: 'supported',
          disruptionType: 'event_overrun',
          targetEventId: teamMeeting!.id,
          targetEventTitle: teamMeeting!.title,
          overrunMinutes: 40,
          protectedEventIds: ['evt-005'], // Doctor's Appointment
          preference: 'minimal_disruption',
          rationale: 'Team meeting delayed 40m, protecting doctor appointment.',
        };
      },
    };

    const result = await runAgentTurn({
      message: "My team meeting is running 40 minutes late. Fix my afternoon, but don't move my doctor's appointment.",
      date: '2026-10-22',
      provider: mockProvider,
      serverConfig: {
        mcpUrl: server.url,
        timeoutMs: 8000,
        calendarTimeZone: 'Asia/Kolkata',
      },
    });

    // 1. Verify structured results
    expect(result.data.status).toBe('plans_ready');
    expect(result.data.calendarUnchanged).toBe(true);

    // 2. Verify conflict analysis
    expect(result.data.analysis).toBeDefined();
    expect(result.data.analysis!.newConflicts.length).toBeGreaterThan(0);

    // 3. Verify proposed recovery plans
    expect(result.data.planSet).toBeDefined();
    expect(result.data.planSet!.candidates.length).toBeGreaterThan(0);
    expect(result.data.selectedPlan).toBeDefined();

    // 4. Verify independent validation result
    expect(result.data.validation).toBeDefined();
    expect(result.data.validation!.isValid).toBe(true);
    expect(result.data.validation!.violations).toHaveLength(0);

    // 5. Verify real tool activity records
    expect(result.activity).toHaveLength(5);
    const toolNames = result.activity.map((a) => a.tool);
    expect(toolNames).toEqual([
      'get_schedule',
      'get_tasks',
      'analyze_conflicts',
      'propose_recovery_plan',
      'validate_recovery_plan',
    ]);
    for (const a of result.activity) {
      expect(a.status).toBe('success');
      expect(a.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof a.startedAt).toBe('string');
    }

    // 6. Verify grounded explanation
    expect(result.data.message).toContain('Team Meeting');
    expect(result.data.message).toContain('40 minutes late');
    expect(result.data.message).toContain('independently validated');
    expect(result.data.message).toContain('Your calendar remains unchanged');

    // 7. Verify SQLite was not modified (read-only architecture enforced)
    expect(fingerprint(server.databasePath!)).toBe(beforeDbFingerprint);
  });

  it('stops cleanly after 2 tool calls when clarification is required', async () => {
    const clarificationProvider: LlmProvider = {
      extractIntent: async () => ({
        status: 'needs_clarification',
        missingInformation: 'duration',
        targetEventId: 'evt-001',
        clarificationQuestion: 'How many minutes is the team meeting delayed?',
        protectedEventIds: [],
        preference: 'minimal_disruption',
        rationale: 'Missing overrun duration',
      }),
    };

    const result = await runAgentTurn({
      message: 'My team meeting is running late.',
      date: '2026-10-22',
      provider: clarificationProvider,
      serverConfig: {
        mcpUrl: server.url,
        timeoutMs: 8000,
        calendarTimeZone: 'Asia/Kolkata',
      },
    });

    expect(result.data.status).toBe('needs_clarification');
    expect(result.data.clarificationQuestion).toBe('How many minutes is the team meeting delayed?');
    expect(result.data.calendarUnchanged).toBe(true);
    expect(result.activity).toHaveLength(2);
    expect(result.activity.map((a) => a.tool)).toEqual(['get_schedule', 'get_tasks']);
    expect(fingerprint(server.databasePath!)).toBe(beforeDbFingerprint);
  });

  it('handles over-constrained infeasible requests truthfully through real Recovery Engine', async () => {
    const overconstrainedProvider: LlmProvider = {
      extractIntent: async () => ({
        status: 'supported',
        disruptionType: 'event_overrun',
        targetEventId: 'evt-001',
        targetEventTitle: 'Team Meeting',
        overrunMinutes: 40,
        // Protecting every other event makes recovery impossible in this window
        protectedEventIds: ['evt-002', 'evt-003', 'evt-004', 'evt-005', 'evt-006'],
        preference: 'minimal_disruption',
        rationale: 'Overconstrained schedule',
      }),
    };

    const result = await runAgentTurn({
      message: "My meeting is late and don't move any other event at all.",
      date: '2026-10-22',
      provider: overconstrainedProvider,
      serverConfig: {
        mcpUrl: server.url,
        timeoutMs: 8000,
        calendarTimeZone: 'Asia/Kolkata',
      },
    });

    expect(result.data.status).toBe('no_feasible_plan');
    expect(result.data.message).toContain('No feasible recovery plan was found');
    expect(result.data.message).toContain('calendar has not been modified');
    expect(result.data.calendarUnchanged).toBe(true);
    expect(result.activity).toHaveLength(4); // get_schedule, get_tasks, analyze, propose (no validate needed for 0 candidates)
    expect(fingerprint(server.databasePath!)).toBe(beforeDbFingerprint);
  });

  it('API route POST /api/agent/turn returns misconfigured when OPENAI_API_KEY is absent', async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const req = new Request('http://localhost/api/agent/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'My team meeting is running 40 minutes late.',
        date: '2026-10-22',
      }),
    });

    try {
      const res = await agentTurnPOST(req);
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('misconfigured');
      expect(json.error.message).toContain('OPENAI_API_KEY');
    } finally {
      if (oldKey) process.env.OPENAI_API_KEY = oldKey;
    }
  });
});
