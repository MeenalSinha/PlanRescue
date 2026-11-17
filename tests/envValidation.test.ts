import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../apps/web/src/lib/envValidation.js';

describe('Spatial Phase 14: Environment Configuration Validation', () => {
  it('validates a correct production environment configuration', () => {
    const env = {
      NODE_ENV: 'production',
      PLANRESCUE_MCP_URL: 'https://mcp.internal.example.com/mcp',
      ENCRYPTION_SECRET: '32-character-high-entropy-secret-key-12345!',
      SESSION_SECRET: 'another-32-char-high-entropy-session-secret!',
      PLANRESCUE_AGENT_ENABLED: 'true',
      PLANRESCUE_AGENT_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-valid-key',
    };

    const res = validateEnvironment(env);
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects short secrets and default placeholders in production', () => {
    const env = {
      NODE_ENV: 'production',
      PLANRESCUE_MCP_URL: 'http://127.0.0.1:3001/mcp',
      ENCRYPTION_SECRET: 'short-secret',
    };

    const res = validateEnvironment(env);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e: string) => e.includes('at least 32 characters'))).toBe(true);
  });

  it('rejects invalid PLANRESCUE_MCP_URL format', () => {
    const env = {
      NODE_ENV: 'development',
      PLANRESCUE_MCP_URL: 'not-a-valid-url',
    };

    const res = validateEnvironment(env);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e: string) => e.includes('PLANRESCUE_MCP_URL'))).toBe(true);
  });
});
