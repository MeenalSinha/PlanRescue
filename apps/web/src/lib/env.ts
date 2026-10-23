/**
 * Server-side configuration. Read only from route handlers; nothing here is ever sent to the browser
 * and no NEXT_PUBLIC_ variable is used.
 */
import * as z from 'zod';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:3001/mcp';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_CALENDAR_TIME_ZONE = 'Asia/Kolkata';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface ServerConfig {
  mcpUrl: string;
  timeoutMs: number;
  calendarTimeZone: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  PLANRESCUE_MCP_URL: z.string().trim().min(1).default(DEFAULT_MCP_URL),
  PLANRESCUE_MCP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(DEFAULT_TIMEOUT_MS),
  PLANRESCUE_CALENDAR_TIME_ZONE: z.string().trim().min(1).default(DEFAULT_CALENDAR_TIME_ZONE),
  PLANRESCUE_ALLOW_REMOTE_MCP: z.enum(['true', 'false']).default('false'),
});

/** Validate the environment. Throws ConfigError with a message that never contains a secret. */
export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  // Blank values (an empty line in .env) mean "use the default".
  const cleaned: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key];
    cleaned[key] = value === undefined || value.trim() === '' ? undefined : value;
  }
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid web configuration (${detail})`);
  }
  const cfg = parsed.data;

  let url: URL;
  try {
    url = new URL(cfg.PLANRESCUE_MCP_URL);
  } catch {
    throw new ConfigError('PLANRESCUE_MCP_URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('PLANRESCUE_MCP_URL must use http or https');
  }
  if (url.username || url.password) {
    throw new ConfigError('PLANRESCUE_MCP_URL must not contain credentials');
  }
  if (cfg.PLANRESCUE_ALLOW_REMOTE_MCP !== 'true' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ConfigError('PLANRESCUE_MCP_URL must point at a loopback host unless PLANRESCUE_ALLOW_REMOTE_MCP=true');
  }
  if (!isValidTimeZone(cfg.PLANRESCUE_CALENDAR_TIME_ZONE)) {
    throw new ConfigError('PLANRESCUE_CALENDAR_TIME_ZONE is not a valid IANA time zone');
  }
  return { mcpUrl: url.toString(), timeoutMs: cfg.PLANRESCUE_MCP_TIMEOUT_MS, calendarTimeZone: cfg.PLANRESCUE_CALENDAR_TIME_ZONE };
}
