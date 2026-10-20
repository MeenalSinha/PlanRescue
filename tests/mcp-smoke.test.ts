import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type ServerHandle } from './helpers/serverProcess.js';

/**
 * End-to-end MCP smoke test.
 *
 * Every assertion below goes through a real MCP client (@modelcontextprotocol/client)
 * speaking Streamable HTTP to a real PlanRescue server process. Nothing imports the tool
 * implementation or calls it directly.
 */

const ISO = (s: string): number => Date.parse(s);

interface ScheduleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  priority: string;
  movable: boolean;
  category: string;
}
interface ScheduleOutput {
  calendarTimeZone: string;
  query: { startTime: string; endTime: string };
  count: number;
  events: ScheduleEvent[];
}

let server: ServerHandle;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.stop();
});

/** The two protocol generations the endpoint serves. Both must satisfy the hackathon floor of 2025-11-25. */
const ERAS = [
  {
    label: 'modern era, pinned to MCP 2026-07-28',
    options: { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    era: 'modern',
    version: '2026-07-28',
  },
  {
    label: 'legacy era, MCP 2025-11-25 initialize handshake',
    options: {},
    era: 'legacy',
    version: '2025-11-25',
  },
] as const;

describe.each(ERAS)('MCP client over Streamable HTTP: $label', ({ options, era, version }) => {
  let client: Client;

  async function schedule(startTime: string, endTime: string): Promise<ScheduleOutput> {
    const result = await client.callTool({ name: 'get_schedule', arguments: { startTime, endTime } });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    return result.structuredContent as unknown as ScheduleOutput;
  }

  async function failing(args: Record<string, unknown>) {
    const result = await client.callTool({ name: 'get_schedule', arguments: args });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const first = result.content[0];
    expect(first?.type).toBe('text');
    return first?.type === 'text' ? first.text : '';
  }

  beforeAll(async () => {
    client = new Client({ name: 'planrescue-smoke-test', version: '0.1.0' }, { ...options });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  });

  afterAll(async () => {
    await client?.close();
  });

  it('completes MCP initialization and negotiates the expected protocol revision', () => {
    expect(client.getProtocolEra()).toBe(era);
    expect(client.getNegotiatedProtocolVersion()).toBe(version);
    // The required floor for the Alexa+ track is 2025-11-25 or later (ISO dates sort lexicographically).
    expect((client.getNegotiatedProtocolVersion() ?? '') >= '2025-11-25').toBe(true);
    expect(client.getServerVersion()).toMatchObject({ name: 'planrescue-mcp-server', version: '0.1.0' });
  });

  it('discovers get_schedule with a validated input schema, output schema and read-only annotations', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_schedule');
    expect(tool, 'get_schedule must be registered').toBeDefined();
    expect(Object.keys(tool!.inputSchema.properties ?? {}).sort()).toEqual(['endTime', 'startTime']);
    expect([...(tool!.inputSchema.required ?? [])].sort()).toEqual(['endTime', 'startTime']);
    expect(tool!.outputSchema).toBeDefined();
    expect(tool!.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
  });

  it('returns the afternoon events for 12:00-18:00 IST, in order, all overlapping the interval', async () => {
    const start = '2026-10-22T12:00:00+05:30';
    const end = '2026-10-22T18:00:00+05:30';
    const out = await schedule(start, end);

    expect(out.calendarTimeZone).toBe('Asia/Kolkata');
    expect(out.query).toEqual({ startTime: start, endTime: end });
    expect(out.count).toBe(out.events.length);
    expect(out.events.map((e) => e.title)).toEqual([
      'Team Meeting', // starts 11:30, still running at 12:00
      'Lunch Break',
      'Project Review',
      'Focus Work',
      "Doctor's Appointment",
    ]);
    // Project Deadline Work starts exactly at 18:00 and must be excluded (half-open interval).
    expect(out.events.map((e) => e.title)).not.toContain('Project Deadline Work');

    for (const e of out.events) {
      expect(ISO(e.startTime)).toBeLessThan(ISO(end));
      expect(ISO(e.endTime)).toBeGreaterThan(ISO(start));
      expect(e.durationMinutes).toBe((ISO(e.endTime) - ISO(e.startTime)) / 60_000);
    }
    const starts = out.events.map((e) => ISO(e.startTime));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('exposes the priority and movable fields later phases need', async () => {
    const out = await schedule('2026-10-22T16:00:00+05:30', '2026-10-22T17:00:00+05:30');
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ title: "Doctor's Appointment", priority: 'critical', movable: false });
  });

  it('returns a different, correctly filtered result for a different interval', async () => {
    const afternoon = await schedule('2026-10-22T12:00:00+05:30', '2026-10-22T18:00:00+05:30');
    const morning = await schedule('2026-10-22T09:00:00+05:30', '2026-10-22T12:00:00+05:30');
    expect(morning.events.map((e) => e.title)).toEqual(['Team Meeting']);
    expect(morning.events.map((e) => e.id)).not.toEqual(afternoon.events.map((e) => e.id));

    const evening = await schedule('2026-10-22T18:00:00+05:30', '2026-10-22T21:00:00+05:30');
    expect(evening.events.map((e) => e.title)).toEqual(['Project Deadline Work']);
  });

  it('applies half-open boundary semantics', async () => {
    const lunchOnly = await schedule('2026-10-22T12:30:00+05:30', '2026-10-22T13:15:00+05:30');
    expect(lunchOnly.events.map((e) => e.title)).toEqual(['Lunch Break']); // Team Meeting ends exactly at 12:30
  });

  it('treats equivalent instants in other UTC offsets identically', async () => {
    const ist = await schedule('2026-10-22T12:00:00+05:30', '2026-10-22T18:00:00+05:30');
    const utc = await schedule('2026-10-22T06:30:00Z', '2026-10-22T12:30:00Z');
    const us = await schedule('2026-10-22T01:30:00-05:00', '2026-10-22T07:30:00-05:00');
    expect(utc.events.map((e) => e.id)).toEqual(ist.events.map((e) => e.id));
    expect(us.events.map((e) => e.id)).toEqual(ist.events.map((e) => e.id));
  });

  it('handles empty results: a gap between events and a different day', async () => {
    const gap = await schedule('2026-10-22T13:15:00+05:30', '2026-10-22T13:30:00+05:30');
    expect(gap.count).toBe(0);
    expect(gap.events).toEqual([]);

    const nextDay = await schedule('2026-10-23T00:00:00+05:30', '2026-10-24T00:00:00+05:30');
    expect(nextDay.count).toBe(0);

    const result = await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-23T00:00:00+05:30', endTime: '2026-10-24T00:00:00+05:30' },
    });
    const first = result.content[0];
    expect(first?.type === 'text' && first.text).toMatch(/^No events between/);
  });

  it('provides a readable text rendering alongside the structured result', async () => {
    const result = await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T12:00:00+05:30', endTime: '2026-10-22T18:00:00+05:30' },
    });
    const first = result.content[0];
    expect(first?.type).toBe('text');
    const text = first?.type === 'text' ? first.text : '';
    expect(text).toContain('5 events between');
    expect(text).toContain('1. Team Meeting');
    expect(text).toContain("5. Doctor's Appointment");
    expect(text.split('\n')).toHaveLength(6);
  });

  describe('rejects invalid input with a clear tool error', () => {
    it('end before start', async () => {
      const text = await failing({ startTime: '2026-10-22T18:00:00+05:30', endTime: '2026-10-22T12:00:00+05:30' });
      expect(text).toMatch(/endTime must be strictly after startTime/);
    });

    it('end equal to start', async () => {
      const text = await failing({ startTime: '2026-10-22T12:00:00+05:30', endTime: '2026-10-22T12:00:00+05:30' });
      expect(text).toMatch(/endTime must be strictly after startTime/);
    });

    it('malformed timestamp', async () => {
      const text = await failing({ startTime: 'tomorrow', endTime: '2026-10-22T18:00:00+05:30' });
      expect(text).toMatch(/startTime/);
      expect(text).toMatch(/explicit UTC offset/);
    });

    it('timestamp without a UTC offset', async () => {
      const text = await failing({ startTime: '2026-10-22T12:00:00', endTime: '2026-10-22T18:00:00' });
      expect(text).toMatch(/explicit UTC offset/);
    });

    it('impossible calendar date', async () => {
      const text = await failing({ startTime: '2026-02-30T12:00:00+05:30', endTime: '2026-03-01T12:00:00+05:30' });
      expect(text).toMatch(/startTime/);
    });

    it('missing parameter', async () => {
      const text = await failing({ startTime: '2026-10-22T12:00:00+05:30' });
      expect(text).toMatch(/endTime/);
    });

    it('wrong parameter types', async () => {
      const text = await failing({ startTime: 5, endTime: null });
      expect(text).toMatch(/startTime/);
      expect(text).toMatch(/endTime/);
    });
  });

  it('answers many concurrent calls consistently', async () => {
    const calls = Array.from({ length: 25 }, () => schedule('2026-10-22T12:00:00+05:30', '2026-10-22T18:00:00+05:30'));
    const results = await Promise.all(calls);
    for (const r of results) expect(r.events.map((e) => e.id)).toEqual(results[0]!.events.map((e) => e.id));
  });

  it('rejects an unknown tool', async () => {
    const outcome = await client.callTool({ name: 'does_not_exist', arguments: {} }).then(
      (r) => ({ rejected: false as const, isError: r.isError }),
      () => ({ rejected: true as const, isError: undefined }),
    );
    expect(outcome.rejected || outcome.isError === true).toBe(true);
  });
});

describe('transport hardening and operational endpoints', () => {
  function rawRequest(opts: { path: string; method?: string; headers?: Record<string, string>; body?: string }) {
    const target = new URL(server.origin);
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          host: target.hostname,
          port: target.port,
          path: opts.path,
          method: opts.method ?? 'GET',
          headers: { ...(opts.headers ?? {}) },
        },
        (res) => {
          let body = '';
          res.on('data', (c: Buffer) => (body += c.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  it('serves a health check that is separate from the MCP endpoint', async () => {
    const res = await rawRequest({ path: '/healthz' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', name: 'planrescue-mcp-server' });
  });

  it('returns 404 for unknown paths', async () => {
    expect((await rawRequest({ path: '/not-here' })).status).toBe(404);
    expect((await rawRequest({ path: '/mcp/extra' })).status).toBe(404);
  });

  it('blocks a foreign Host header (DNS rebinding protection)', async () => {
    const res = await rawRequest({
      path: '/mcp',
      method: 'POST',
      headers: { host: 'evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('blocks a foreign Origin header', async () => {
    const res = await rawRequest({
      path: '/mcp',
      method: 'POST',
      headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('answers malformed JSON with a client error and keeps serving', async () => {
    const bad = await rawRequest({
      path: '/mcp',
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{not json',
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect((await rawRequest({ path: '/healthz' })).status).toBe(200);
  });
});

describe('server logs reflect real activity', () => {
  it('recorded the tool calls, matches, and rejections that the client just made', (ctx) => {
    if (server.external) ctx.skip();
    const logs = server.logs();
    expect(logs).toContain('Transport: Streamable HTTP');
    expect(logs).toContain(`Endpoint: ${server.url}`);
    expect(logs).toContain('Tool registered: get_schedule');
    expect(logs).toContain('Tool: get_schedule | Requested interval: [2026-10-22T12:00:00+05:30, 2026-10-22T18:00:00+05:30)');
    expect(logs).toContain('Tool: get_schedule | Matching events: 5 | Status: success');
    expect(logs).toContain('Tool: get_schedule | Matching events: 0 | Status: success');
    expect(logs).toContain('Status: rejected | Reason: endTime must be strictly after startTime');
    expect(logs).toContain('Status: rejected | Invalid input | startTime');
  });

  it('shuts down cleanly on SIGTERM', async (ctx) => {
    if (server.external) ctx.skip();
    const exit = await server.stop();
    expect(exit).toEqual({ code: 0, signal: null });
    expect(server.logs()).toContain('Received SIGTERM, shutting down');
    expect(server.logs()).toContain('Shutdown complete');
  });
});
