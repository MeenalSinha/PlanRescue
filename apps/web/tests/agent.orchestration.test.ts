// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@/lib/agent/provider';
import type { ExtractedIntent } from '@/lib/agent/types';
import { analysisWithConflict, EVENTS, plan, TASKS, validation } from './fixtures';

const state = vi.hoisted(() => ({
  connect: null as null | (() => Promise<void>),
  call: null as null | ((tool: string, args: Record<string, unknown>) => Promise<unknown>),
  closed: 0,
}));

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    connect() {
      return state.connect!();
    }
    callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
      return state.call!(name, args);
    }
    async close() {
      state.closed += 1;
    }
  },
  StreamableHTTPClientTransport: class {},
}));

import { runAgentTurn } from '@/lib/agent/orchestrator';

const testConfig = {
  mcpUrl: 'http://127.0.0.1:3001/mcp',
  timeoutMs: 5000,
  calendarTimeZone: 'Asia/Kolkata',
};

describe('Agent Orchestration Workflow', () => {
  const toolCallsMade: string[] = [];

  beforeEach(() => {
    toolCallsMade.length = 0;
    state.connect = async () => undefined;
    state.closed = 0;
    state.call = async (tool, _args) => {
      toolCallsMade.push(tool);
      if (tool === 'get_schedule') {
        return { structuredContent: { calendarTimeZone: 'Asia/Kolkata', count: EVENTS.length, events: EVENTS } };
      }
      if (tool === 'get_tasks') {
        return { structuredContent: { taskTimeZone: 'Asia/Kolkata', count: TASKS.length, tasks: TASKS } };
      }
      if (tool === 'analyze_conflicts') {
        return { structuredContent: analysisWithConflict() };
      }
      if (tool === 'propose_recovery_plan') {
        const p1 = plan('plan-001', 1, 'minimal_disruption');
        return {
          structuredContent: {
            interval: { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' },
            disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
            protectedEventIds: ['evt-005'],
            outcome: 'plans_found',
            candidates: [p1],
            discardedStrategies: [],
            infeasibility: null,
            rankingFormula: 'penalties',
            warnings: [],
            summary: '1 candidate found',
          },
        };
      }
      if (tool === 'validate_recovery_plan') {
        return { structuredContent: validation({ planId: 'plan-001', isValid: true }) };
      }
      return { structuredContent: {} };
    };
  });

  it('runs complete sequence: get_schedule -> get_tasks -> LLM -> analyze -> propose -> validate', async () => {
    const mockProvider: LlmProvider = {
      extractIntent: async () => ({
        status: 'supported',
        disruptionType: 'event_overrun',
        targetEventId: 'evt-001',
        targetEventTitle: 'Team Meeting',
        overrunMinutes: 40,
        protectedEventIds: ['evt-005'],
        preference: 'minimal_disruption',
        rationale: 'Team meeting delayed 40m',
      }),
    };

    const result = await runAgentTurn({
      message: "My team meeting is running 40 minutes late. Don't move my doctor's appointment.",
      date: '2026-10-22',
      provider: mockProvider,
      serverConfig: testConfig,
    });

    expect(toolCallsMade).toEqual([
      'get_schedule',
      'get_tasks',
      'analyze_conflicts',
      'propose_recovery_plan',
      'validate_recovery_plan',
    ]);

    expect(result.data.status).toBe('plans_ready');
    expect(result.data.calendarUnchanged).toBe(true);
    expect(result.data.selectedPlan?.planId).toBe('plan-001');
    expect(result.data.validation?.isValid).toBe(true);
    expect(result.data.message).toContain('Team Meeting');
    expect(result.data.message).toContain('40 minutes late');
    expect(result.data.message).toContain('independently validated');
    expect(result.data.message).toContain('calendar remains unchanged');
    expect(result.activity).toHaveLength(5);
  });

  it('stops immediately before planning when clarification is required', async () => {
    const mockClarificationProvider: LlmProvider = {
      extractIntent: async () => ({
        status: 'needs_clarification',
        missingInformation: 'event',
        clarificationQuestion: 'Which meeting is running late?',
        protectedEventIds: [],
        preference: 'minimal_disruption',
        rationale: 'Event name missing',
      }),
    };

    const result = await runAgentTurn({
      message: 'My meeting is late',
      date: '2026-10-22',
      provider: mockClarificationProvider,
      serverConfig: testConfig,
    });

    expect(toolCallsMade).toEqual(['get_schedule', 'get_tasks']);
    expect(result.data.status).toBe('needs_clarification');
    expect(result.data.clarificationQuestion).toBe('Which meeting is running late?');
    expect(result.data.calendarUnchanged).toBe(true);
    expect(result.activity).toHaveLength(2);
  });

  it('stops immediately before planning when request is unsupported', async () => {
    const mockUnsupportedProvider: LlmProvider = {
      extractIntent: async () => ({
        status: 'unsupported',
        unsupportedReason: 'Deleting meetings is not supported.',
        protectedEventIds: [],
        preference: 'minimal_disruption',
        rationale: 'User wants to delete meeting',
      }),
    };

    const result = await runAgentTurn({
      message: 'Delete my project review',
      date: '2026-10-22',
      provider: mockUnsupportedProvider,
      serverConfig: testConfig,
    });

    expect(toolCallsMade).toEqual(['get_schedule', 'get_tasks']);
    expect(result.data.status).toBe('unsupported_request');
    expect(result.data.message).toContain('Deleting meetings is not supported');
    expect(result.data.calendarUnchanged).toBe(true);
    expect(result.activity).toHaveLength(2);
  });

  it('handles infeasible recovery outcome honestly without inventing plans', async () => {
    state.call = async (tool, _args) => {
      toolCallsMade.push(tool);
      if (tool === 'get_schedule') {
        return { structuredContent: { calendarTimeZone: 'Asia/Kolkata', count: EVENTS.length, events: EVENTS } };
      }
      if (tool === 'get_tasks') {
        return { structuredContent: { taskTimeZone: 'Asia/Kolkata', count: TASKS.length, tasks: TASKS } };
      }
      if (tool === 'analyze_conflicts') {
        return { structuredContent: analysisWithConflict() };
      }
      if (tool === 'propose_recovery_plan') {
        return {
          structuredContent: {
            interval: { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' },
            disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
            protectedEventIds: ['evt-002', 'evt-003', 'evt-005'],
            outcome: 'infeasible',
            candidates: [],
            discardedStrategies: [],
            infeasibility: {
              reasons: [{ code: 'fixed_commitment', eventIds: ['evt-005'], message: "Cannot move Doctor's Appointment" }],
              summary: 'Every alternative violated a protected commitment.',
            },
            rankingFormula: 'penalties',
            warnings: [],
            summary: 'Infeasible',
          },
        };
      }
      return { structuredContent: {} };
    };

    const mockProvider: LlmProvider = {
      extractIntent: async () => ({
        status: 'supported',
        disruptionType: 'event_overrun',
        targetEventId: 'evt-001',
        targetEventTitle: 'Team Meeting',
        overrunMinutes: 40,
        protectedEventIds: ['evt-002', 'evt-003', 'evt-005'],
        preference: 'minimal_disruption',
        rationale: 'Over-constrained scenario',
      }),
    };

    const result = await runAgentTurn({
      message: 'Team meeting running 40 min late, protect everything else',
      date: '2026-10-22',
      provider: mockProvider,
      serverConfig: testConfig,
    });

    expect(toolCallsMade).toEqual(['get_schedule', 'get_tasks', 'analyze_conflicts', 'propose_recovery_plan']);
    expect(result.data.status).toBe('no_feasible_plan');
    expect(result.data.message).toContain('No feasible recovery plan was found');
    expect(result.data.message).toContain('calendar has not been modified');
    expect(result.data.calendarUnchanged).toBe(true);
  });
});
