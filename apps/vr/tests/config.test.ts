import { describe, expect, it } from 'vitest';
import { parseConfigFromEnv, validateConfig } from '../src/config/loader';
import { ConfigurationError } from '../src/config/schema';

describe('VR Configuration System', () => {
  it('validates a correct configuration with defaults', () => {
    const valid = {
      apiBaseUrl: 'http://127.0.0.1:3000',
    };
    const config = validateConfig(valid);
    expect(config.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(config.appEnv).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.requestTimeoutMs).toBe(15000);
    expect(config.xr.enableHandTracking).toBe(true);
    expect(config.xr.enableEmulation).toBe(true);
  });

  it('rejects loopback/localhost apiBaseUrl in production', () => {
    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://127.0.0.1:3000',
        appEnv: 'production',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://localhost:3000',
        appEnv: 'production',
      }),
    ).toThrow(ConfigurationError);

    // Valid production URL succeeds
    const prodConfig = validateConfig({
      apiBaseUrl: 'https://spatial.planrescue.app',
      appEnv: 'production',
    });
    expect(prodConfig.appEnv).toBe('production');
    expect(prodConfig.apiBaseUrl).toBe('https://spatial.planrescue.app');
  });

  it('rejects missing apiBaseUrl', () => {
    expect(() => validateConfig({})).toThrow(ConfigurationError);
  });

  it('rejects an invalid apiBaseUrl (not a valid HTTP/HTTPS URL)', () => {
    expect(() =>
      validateConfig({
        apiBaseUrl: 'not-a-valid-url',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      validateConfig({
        apiBaseUrl: 'ftp://localhost/api',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects invalid appEnv values', () => {
    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://127.0.0.1:3000',
        appEnv: 'production-fake',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects out-of-range requestTimeoutMs', () => {
    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://127.0.0.1:3000',
        requestTimeoutMs: 100, // min is 1000
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://127.0.0.1:3000',
        requestTimeoutMs: 900000, // max is 60000
      }),
    ).toThrow(ConfigurationError);
  });

  it('parses environment variables into configuration fields', () => {
    const env = {
      VITE_PLANRESCUE_VR_APP_ENV: 'staging',
      VITE_PLANRESCUE_VR_API_BASE_URL: 'https://staging.example.com',
      VITE_PLANRESCUE_VR_LOG_LEVEL: 'debug',
      VITE_PLANRESCUE_VR_REQUEST_TIMEOUT_MS: '25000',
      VITE_PLANRESCUE_VR_ENABLE_HAND_TRACKING: 'false',
      VITE_PLANRESCUE_VR_ENABLE_EMULATION: 'true',
    };

    const parsed = parseConfigFromEnv(env);
    const config = validateConfig(parsed);

    expect(config.appEnv).toBe('staging');
    expect(config.apiBaseUrl).toBe('https://staging.example.com');
    expect(config.logLevel).toBe('debug');
    expect(config.requestTimeoutMs).toBe(25000);
    expect(config.xr.enableHandTracking).toBe(false);
    expect(config.xr.enableEmulation).toBe(true);
  });

  it('rejects loopback/localhost apiBaseUrl in production', () => {
    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://127.0.0.1:3000',
        appEnv: 'production',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      validateConfig({
        apiBaseUrl: 'http://localhost:3000',
        appEnv: 'production',
      }),
    ).toThrow(ConfigurationError);

    // Valid production URL succeeds
    const prodConfig = validateConfig({
      apiBaseUrl: 'https://spatial.planrescue.app',
      appEnv: 'production',
    });
    expect(prodConfig.appEnv).toBe('production');
    expect(prodConfig.apiBaseUrl).toBe('https://spatial.planrescue.app');
  });
});
