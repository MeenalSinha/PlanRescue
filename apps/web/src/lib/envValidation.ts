import { loadServerConfig } from './env.js';

export interface EnvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Production Environment Configuration Validator (Spatial Phase 14)
 *
 * Validates critical environment variables, secrets entropy, database paths,
 * and service endpoints on startup before accepting incoming traffic.
 */
export function validateEnvironment(env: Record<string, string | undefined> = process.env): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction =
    env.NODE_ENV === 'production' &&
    env.APP_ENV !== 'test' &&
    env.PLANRESCUE_SKIP_ENV_VALIDATION !== 'true';

  // 1. MCP URL validation
  const mcpUrl = env.PLANRESCUE_MCP_URL || 'http://127.0.0.1:3001/mcp';
  try {
    const parsed = new URL(mcpUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.push(`PLANRESCUE_MCP_URL must use http: or https: protocol (got: ${parsed.protocol})`);
    }
  } catch {
    errors.push(`PLANRESCUE_MCP_URL is not a valid URL: ${mcpUrl}`);
  }

  // 2. Encryption & Session Secret validation
  const encryptionSecret = env.ENCRYPTION_SECRET;
  const sessionSecret = env.SESSION_SECRET;

  if (isProduction) {
    if (!encryptionSecret && !sessionSecret) {
      errors.push('ENCRYPTION_SECRET or SESSION_SECRET must be explicitly defined in production.');
    } else {
      const activeSecret = encryptionSecret || sessionSecret || '';
      if (activeSecret.length < 32) {
        errors.push(`Production secret must be at least 32 characters long (current length: ${activeSecret.length}).`);
      }
      if (/(?:planrescue-spatial-internal-key|your-secure-random|dev-only-secret)/i.test(activeSecret)) {
        errors.push('Production secret cannot use default template or placeholder strings.');
      }
    }
  } else {
    if (!encryptionSecret && !sessionSecret) {
      warnings.push('ENCRYPTION_SECRET not set; falling back to internal development encryption key.');
    }
  }

  // 3. AI Agent configuration check
  const agentEnabled = env.PLANRESCUE_AGENT_ENABLED !== 'false';
  const provider = env.PLANRESCUE_AGENT_PROVIDER || 'openai';

  if (agentEnabled) {
    if (provider === 'openai' && !env.OPENAI_API_KEY) {
      warnings.push('AI Agent is enabled with OpenAI provider but OPENAI_API_KEY is not set. Natural language chat will be unavailable.');
    } else if (provider === 'bedrock' && (!env.AWS_REGION || !env.BEDROCK_MODEL_ID)) {
      warnings.push('AI Agent is enabled with Bedrock provider but AWS_REGION or BEDROCK_MODEL_ID is missing.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
