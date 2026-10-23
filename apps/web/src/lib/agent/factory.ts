/**
 * Provider factory for selecting the configured natural-language AI agent provider.
 * Supports OpenAI and Amazon Bedrock models through a unified LlmProvider interface.
 */
import { BedrockProvider } from './bedrockProvider';
import { loadAgentConfig, OpenAiProvider, type LlmProvider } from './provider';
import type { AgentConfig } from './types';

export function createAgentProvider(config: AgentConfig = loadAgentConfig()): LlmProvider {
  if (config.provider === 'bedrock') {
    return new BedrockProvider(config);
  }
  return new OpenAiProvider(config);
}
