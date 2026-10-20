import { existsSync } from 'node:fs';
import * as z from 'zod/v4';

const envSchema = z.object({
  MCP_HOST: z.string().trim().min(1).default('127.0.0.1'),
  MCP_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  MCP_PATH: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9._~\-/]*$/, 'must start with "/" and contain only URL-safe path characters')
    .default('/mcp'),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MCP_ALLOWED_HOSTS: z.string().default(''),
});

export interface Config {
  host: string;
  port: number;
  path: string;
  appEnv: 'development' | 'test' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Extra hostnames accepted by the Host header guard (beyond loopback names). */
  allowedHosts: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parse and validate configuration from an environment-like object. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as "unset" so a bare `MCP_PORT=` in .env falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${details}`);
  }
  const v = result.data;
  return {
    host: v.MCP_HOST,
    port: v.MCP_PORT,
    path: v.MCP_PATH.length > 1 ? v.MCP_PATH.replace(/\/+$/, '') : v.MCP_PATH,
    appEnv: v.APP_ENV,
    logLevel: v.LOG_LEVEL,
    allowedHosts: v.MCP_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  };
}

/** Load `.env` from the working directory when present (Node built-in; no extra dependency), then parse. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  return parseConfig(env);
}
