import { ConfigurationError, vrConfigSchema, type VrConfig } from './schema';

declare global {
  interface Window {
    __PLANRESCUE_VR_CONFIG__?: Partial<VrConfig>;
  }
}

/**
 * Loads configuration from raw record and validates strictly against schema.
 */
export function validateConfig(raw: Record<string, unknown>): VrConfig {
  const result = vrConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
    );
    throw new ConfigurationError(`Invalid VR configuration:\n  - ${issues.join('\n  - ')}`, issues);
  }
  return result.data;
}

/**
 * Parses configuration from environment variables (e.g., import.meta.env).
 */
export function parseConfigFromEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  const appEnv = env.VITE_PLANRESCUE_VR_APP_ENV ?? env.PLANRESCUE_VR_APP_ENV;
  const apiBaseUrl = env.VITE_PLANRESCUE_VR_API_BASE_URL ?? env.PLANRESCUE_VR_API_BASE_URL;
  const logLevel = env.VITE_PLANRESCUE_VR_LOG_LEVEL ?? env.PLANRESCUE_VR_LOG_LEVEL;
  const timeoutStr = env.VITE_PLANRESCUE_VR_REQUEST_TIMEOUT_MS ?? env.PLANRESCUE_VR_REQUEST_TIMEOUT_MS;
  const enableHandTracking = env.VITE_PLANRESCUE_VR_ENABLE_HAND_TRACKING ?? env.PLANRESCUE_VR_ENABLE_HAND_TRACKING;
  const enableEmulation = env.VITE_PLANRESCUE_VR_ENABLE_EMULATION ?? env.PLANRESCUE_VR_ENABLE_EMULATION;

  const raw: Record<string, unknown> = {};

  if (appEnv !== undefined && appEnv !== '') raw.appEnv = appEnv;
  if (apiBaseUrl !== undefined && apiBaseUrl !== '') raw.apiBaseUrl = apiBaseUrl;
  if (logLevel !== undefined && logLevel !== '') raw.logLevel = logLevel;
  if (timeoutStr !== undefined && timeoutStr !== '') raw.requestTimeoutMs = Number(timeoutStr);

  const xr: Record<string, unknown> = {};
  if (enableHandTracking !== undefined && enableHandTracking !== '') {
    xr.enableHandTracking = enableHandTracking === 'true' || enableHandTracking === '1';
  }
  if (enableEmulation !== undefined && enableEmulation !== '') {
    xr.enableEmulation = enableEmulation === 'true' || enableEmulation === '1';
  }

  if (Object.keys(xr).length > 0) {
    raw.xr = xr;
  }

  return raw;
}

/**
 * Merges configuration sources with explicit precedence:
 * Priority (highest to lowest):
 * 1. window.__PLANRESCUE_VR_CONFIG__ (runtime injection)
 * 2. Environment variables (deployment / build-time env)
 * 3. Static fallback file (/config.json)
 */
export function mergeConfigSources(
  fileRaw: Record<string, unknown> = {},
  envRaw: Record<string, unknown> = {},
  windowRaw: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...fileRaw,
    ...envRaw,
    ...windowRaw,
    xr: {
      ...(typeof fileRaw.xr === 'object' && fileRaw.xr ? (fileRaw.xr as Record<string, unknown>) : {}),
      ...(typeof envRaw.xr === 'object' && envRaw.xr ? (envRaw.xr as Record<string, unknown>) : {}),
      ...(typeof windowRaw.xr === 'object' && windowRaw.xr ? (windowRaw.xr as Record<string, unknown>) : {}),
    },
  };
}

/**
 * Loads configuration with runtime priority:
 * 1. window.__PLANRESCUE_VR_CONFIG__ (runtime injection)
 * 2. Environment variables (Vite build-time or deployment env)
 * 3. Fetched /config.json (static fallback file, if available)
 */
export async function loadRuntimeConfig(): Promise<VrConfig> {
  // Step 1: Collect environment-based configuration
  const envSource = typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env as Record<string, string | undefined>)
    : {};
  const envRaw = parseConfigFromEnv(envSource);

  // Step 2: Attempt to load runtime file config if in a browser environment
  let fileRaw: Record<string, unknown> = {};
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    try {
      const configUrl = (import.meta.env?.BASE_URL || './') + 'config.json';
      let response = await window.fetch(configUrl, { cache: 'no-cache' }).catch(() => null);
      if (!response || (!response.ok && configUrl !== '/config.json')) {
        response = await window.fetch('/config.json', { cache: 'no-cache' }).catch(() => null);
      }
      if (response && response.ok) {
        fileRaw = await response.json();
      }
    } catch {
      // /config.json is optional; failure falls back to env defaults
    }
  }

  // Step 3: Check runtime window injection
  const windowRaw = typeof window !== 'undefined' && window.__PLANRESCUE_VR_CONFIG__
    ? (window.__PLANRESCUE_VR_CONFIG__ as Record<string, unknown>)
    : {};

  // Merge with strict priority: window injection > env vars > static file
  const merged = mergeConfigSources(fileRaw, envRaw, windowRaw);

  // If in browser and apiBaseUrl is still not set, default to origin if http/https
  if (
    !merged.apiBaseUrl &&
    typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.origin !== 'null' &&
    window.location.origin.startsWith('http')
  ) {
    merged.apiBaseUrl = window.location.origin;
  }

  return validateConfig(merged);
}
