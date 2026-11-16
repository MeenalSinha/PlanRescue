import { describe, expect, it } from 'vitest';
import { normalizeError, VrBaseError } from '../src/diagnostics/errorBoundary';
import { redactSensitiveData, VrLogger } from '../src/logging/logger';

describe('Diagnostics & Logging System', () => {
  it('filters log messages below configured level', () => {
    const logger = new VrLogger('warn');
    const logs: string[] = [];

    logger.addListener((record) => {
      logs.push(`${record.level}:${record.message}`);
    });

    logger.debug('Test', 'This is debug');
    logger.info('Test', 'This is info');
    logger.warn('Test', 'This is warn');
    logger.error('Test', 'This is error');

    expect(logs).toEqual(['warn:This is warn', 'error:This is error']);
  });

  it('redacts sensitive keys from log data payloads', () => {
    const payload = {
      username: 'alice',
      userToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      apiKey: 'sk-proj-1234567890',
      dbPassword: 'super-secret-pw',
      authHeader: 'Bearer secret_value_here',
      nested: {
        clientSecret: 'secret_nested',
        publicField: 42,
      },
    };

    const redacted = redactSensitiveData(payload) as Record<string, any>;

    expect(redacted.username).toBe('alice');
    expect(redacted.userToken).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.dbPassword).toBe('[REDACTED]');
    expect(redacted.nested.clientSecret).toBe('[REDACTED]');
    expect(redacted.nested.publicField).toBe(42);
  });

  it('redacts Bearer tokens from raw strings', () => {
    const message = 'Request failed with Bearer eyJhbGciOiJIUzI1NiIs.invalid';
    const redacted = redactSensitiveData(message);
    expect(redacted).toBe('Request failed with Bearer [REDACTED]');
  });

  it('normalizes VrBaseErrors faithfully', () => {
    const customErr = new VrBaseError({
      message: 'Underlying hardware failed',
      category: 'xr_session',
      severity: 'error',
      userMessage: 'Headset tracking was lost.',
      recoverable: true,
    });

    const normalized = normalizeError(customErr);
    expect(normalized.category).toBe('xr_session');
    expect(normalized.userMessage).toBe('Headset tracking was lost.');
    expect(normalized.technicalDetails).toBe('Underlying hardware failed');
    expect(normalized.recoverable).toBe(true);
  });

  it('sanitizes unexpected native errors without leaking internal filesystem paths', () => {
    const nativeErr = new Error('Cannot find file C:\\Users\\Administrator\\secrets\\credentials.json');
    const normalized = normalizeError(nativeErr);

    expect(normalized.category).toBe('runtime_unexpected');
    expect(normalized.userMessage).toBe('An unexpected application error occurred.');
    expect(normalized.technicalDetails).not.toContain('C:\\Users\\Administrator\\secrets\\credentials.json');
    expect(normalized.technicalDetails).toContain('[path]');
  });
});
