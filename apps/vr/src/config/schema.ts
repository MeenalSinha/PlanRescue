import * as z from 'zod';

export const appEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type AppEnv = z.infer<typeof appEnvSchema>;

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const xrConfigSchema = z.object({
  sessionMode: z.enum(['immersive-vr', 'inline']).default('immersive-vr'),
  enableHandTracking: z.boolean().default(true),
  enableEmulation: z.boolean().default(true),
});
export type XrConfig = z.infer<typeof xrConfigSchema>;

export const vrConfigSchema = z.object({
  appEnv: appEnvSchema.default('development'),
  apiBaseUrl: z
    .string()
    .trim()
    .min(1, 'API base URL is required')
    .refine((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'API base URL must be a valid HTTP or HTTPS URL'),
  logLevel: logLevelSchema.default('info'),
  requestTimeoutMs: z.coerce.number().int().min(1000).max(60000).default(15000),
  xr: xrConfigSchema.default({
    sessionMode: 'immersive-vr',
    enableHandTracking: true,
    enableEmulation: true,
  }),
});

export type VrConfig = z.infer<typeof vrConfigSchema>;

export class ConfigurationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}
