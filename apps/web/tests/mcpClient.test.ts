// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

const state = vi.hoisted(() => ({
  connect: null as null | (() => Promise<void>),
  call: null as null | (() => Promise<unknown>),
  closed: 0,
}));

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    connect() {
      return state.connect!();
    }
    callTool() {
      return state.call!();
    }
    async close() {
      state.closed += 1;
    }
  },
  StreamableHTTPClientTransport: class {},
}));

import { McpCallError, callMcpTool } from '@/lib/mcpClient';

const config = { mcpUrl: 'http://127.0.0.1:3001/mcp', timeoutMs: 1_000, calendarTimeZone: 'Asia/Kolkata' };
const schema = z.looseObject({ count: z.number() });

async function failure(): Promise<McpCallError> {
  try {
    await callMcpTool('get_schedule', {}, schema, () => '', config);
  } catch (e) {
    return e as McpCallError;
  }
  throw new Error('expected a failure');
}

beforeEach(() => {
  state.connect = async () => undefined;
  state.call = async () => ({ structuredContent: { count: 2, extra: 'kept' } });
  state.closed = 0;
});

describe('callMcpTool', () => {
  it('returns validated structured content and a real activity record', async () => {
    const r = await callMcpTool('get_schedule', {}, schema, (d) => `${d.count} events`, config);
    expect(r.data).toEqual({ count: 2, extra: 'kept' });
    expect(r.activity).toMatchObject({ tool: 'get_schedule', status: 'success', summary: '2 events' });
    expect(r.activity.durationMs).toBeGreaterThanOrEqual(0);
    expect(state.closed).toBe(1);
  });

  it('maps a tool-level isError result to mcp_tool_error, keeping the server message', async () => {
    state.call = async () => ({ isError: true, content: [{ type: 'text', text: 'Invalid request: bad event' }] });
    const e = await failure();
    expect(e.code).toBe('mcp_tool_error');
    expect(e.message).toBe('Invalid request: bad event');
    expect(e.activity).toMatchObject({ status: 'error', errorCode: 'mcp_tool_error' });
    expect(state.closed).toBe(1);
  });

  it('treats a missing structuredContent as malformed', async () => {
    state.call = async () => ({ content: [{ type: 'text', text: 'hi' }] });
    expect((await failure()).code).toBe('malformed_result');
    expect(state.closed).toBe(1);
  });

  it('treats a result that breaks the contract as malformed', async () => {
    state.call = async () => ({ structuredContent: { count: 'two' } });
    expect((await failure()).code).toBe('malformed_result');
  });

  it('reports an unreachable server without leaking the URL or the cause', async () => {
    state.connect = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3001');
    };
    const e = await failure();
    expect(e.code).toBe('mcp_unavailable');
    expect(e.message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    expect(state.closed).toBe(1);
  });

  it('reports a timeout', async () => {
    state.call = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };
    expect((await failure()).code).toBe('mcp_timeout');
    expect(state.closed).toBe(1);
  });
});
