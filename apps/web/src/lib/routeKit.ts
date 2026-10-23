/** Shared plumbing for the API route handlers: body limits, uniform JSON envelopes, error mapping. */
import { NextResponse } from 'next/server';
import * as z from 'zod';
import type { ApiErrorCode, ApiResponse, ToolActivity } from './api';
import { ConfigError, loadServerConfig, type ServerConfig } from './env';
import { fieldErrors } from './requests';
import { McpCallError, type ToolCallSuccess } from './mcpClient';

const STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  payload_too_large: 413,
  mcp_tool_error: 422,
  mcp_unavailable: 503,
  mcp_timeout: 504,
  mcp_protocol_error: 502,
  malformed_result: 502,
  misconfigured: 500,
  internal_error: 500,
  network_error: 503,
  bad_response: 502,
};

const NO_STORE = { 'Cache-Control': 'no-store' };

export function ok<T>(data: T, activity: ToolActivity[]): NextResponse {
  const body: ApiResponse<T> = { ok: true, data, activity };
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}

export function fail(code: ApiErrorCode, message: string, activity: ToolActivity[] = [], fields?: Record<string, string>): NextResponse {
  const body: ApiResponse<never> = { ok: false, error: { code, message, ...(fields ? { fields } : {}) }, activity };
  return NextResponse.json(body, { status: STATUS[code], headers: NO_STORE });
}

/** Turn any thrown value into a safe response. Details go to the server log, never to the browser. */
export function failFrom(error: unknown, activity: ToolActivity[] = []): NextResponse {
  if (error instanceof McpCallError) return fail(error.code, error.message, [...activity, error.activity]);
  if (error instanceof ConfigError) {
    console.error(`[planrescue-web] configuration error: ${error.message}`);
    return fail('misconfigured', 'The web server is not configured correctly. Check PLANRESCUE_MCP_URL in apps/web/.env.local.', activity);
  }
  console.error(`[planrescue-web] unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return fail('internal_error', 'Something went wrong on the server. Please try again.', activity);
}

/** Read a JSON body with a hard size limit. Returns a ready-made error response on any problem. */
export async function readJson(request: Request, maxBytes: number): Promise<{ value: unknown } | { response: NextResponse }> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return { response: fail('invalid_request', 'Send the request as application/json.') };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { response: fail('payload_too_large', 'The request is too large.') };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { response: fail('invalid_request', 'The request body could not be read.') };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { response: fail('payload_too_large', 'The request is too large.') };
  }
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { response: fail('invalid_request', 'The request body is not valid JSON.') };
  }
}

export interface ToolRouteOptions<S extends z.ZodType, TOut> {
  maxBytes: number;
  schema: S;
  /** Receives the validated input AND the original parsed body (for pass-through tools). */
  call(input: z.infer<S>, original: unknown, config: ServerConfig): Promise<ToolCallSuccess<TOut>>;
}

/** The shape shared by analyze, propose and validate: limit, parse, validate, call one tool, respond. */
export async function handleToolRoute<S extends z.ZodType, TOut>(request: Request, options: ToolRouteOptions<S, TOut>): Promise<NextResponse> {
  const body = await readJson(request, options.maxBytes);
  if ('response' in body) return body.response;
  const parsed = options.schema.safeParse(body.value);
  if (!parsed.success) {
    const fields = fieldErrors(parsed.error);
    return fail('invalid_request', 'Some of the request values are not valid.', [], fields);
  }
  try {
    const config = loadServerConfig();
    const result = await options.call(parsed.data, body.value, config);
    return ok(result.data, [result.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
