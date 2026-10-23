/**
 * Server-side MCP client helper. This is the ONLY way the web application reaches scheduling data:
 * every call opens a real Streamable HTTP connection to the PlanRescue MCP server with the official
 * MCP TypeScript SDK, calls one registered tool, validates the structured result, and closes the
 * connection in a finally block. Import it from route handlers only; it is never bundled for the browser.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { randomUUID } from 'node:crypto';
import type * as z from 'zod';
import type { ApiErrorCode, ToolActivity, ToolName } from './api';
import { loadServerConfig, type ServerConfig } from './env';

export class McpCallError extends Error {
  override name = 'McpCallError';
  constructor(
    readonly code: ApiErrorCode,
    /** Safe to show to the user. Never contains a stack trace, URL or path. */
    message: string,
    readonly activity: ToolActivity,
  ) {
    super(message);
  }
}

interface RawToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

export interface ToolCallSuccess<T> {
  data: T;
  activity: ToolActivity;
}

export type SummaryFn<T> = (data: T) => string;

function textOf(result: RawToolResult): string {
  return (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!)
    .join('\n')
    .trim();
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError' || (error instanceof Error && /timed? ?out/i.test(error.message));
}

/**
 * Call one MCP tool and return its validated structured content together with an activity record.
 * Throws McpCallError (which carries the activity record of the failed call) on every failure.
 */
export async function callMcpTool<S extends z.ZodType>(
  tool: ToolName,
  args: Record<string, unknown>,
  schema: S,
  summarize: SummaryFn<z.infer<S>>,
  config: ServerConfig = loadServerConfig(),
): Promise<ToolCallSuccess<z.infer<S>>> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const record = (status: 'success' | 'error', summary: string, errorCode?: ApiErrorCode): ToolActivity => ({
    id: randomUUID(),
    tool,
    status,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    summary,
    ...(errorCode ? { errorCode } : {}),
  });
  const fail = (code: ApiErrorCode, message: string): McpCallError => new McpCallError(code, message, record('error', message, code));

  const client = new Client({ name: 'planrescue-web', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    let raw: RawToolResult;
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpUrl)), { signal });
      raw = (await client.callTool({ name: tool, arguments: args }, { signal, timeout: config.timeoutMs })) as unknown as RawToolResult;
    } catch (error) {
      if (isTimeout(error, signal)) {
        throw fail('mcp_timeout', 'The PlanRescue MCP server did not respond in time.');
      }
      console.error(`[planrescue-web] ${tool}: MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw fail('mcp_unavailable', 'The PlanRescue MCP server is not reachable.');
    }

    if (raw.isError === true) {
      // A tool-level error (for example rejected input). Not a transport failure and not an invalid plan.
      throw fail('mcp_tool_error', textOf(raw) || 'The MCP tool reported an error.');
    }
    if (raw.structuredContent === undefined || raw.structuredContent === null) {
      console.error(`[planrescue-web] ${tool}: result had no structuredContent`);
      throw fail('malformed_result', 'The MCP tool returned a result the application could not read.');
    }
    const parsed = schema.safeParse(raw.structuredContent);
    if (!parsed.success) {
      console.error(`[planrescue-web] ${tool}: result failed contract check: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      throw fail('malformed_result', 'The MCP tool returned a result the application could not read.');
    }
    return { data: parsed.data, activity: record('success', summarize(parsed.data)) };
  } finally {
    await client.close().catch(() => undefined);
  }
}
