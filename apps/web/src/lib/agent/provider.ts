/**
 * Real LLM provider adapter using the official OpenAI TypeScript SDK.
 *
 * Provides structured intent extraction with Zod schema validation, timeouts,
 * and safe error handling.
 */
import OpenAI from 'openai';
import { rawExtractedIntentSchema, type RawExtractedIntent } from './schemas';
import { SYSTEM_PROMPT, buildUserGroundingMessage } from './systemPrompt';
import type { AgentChatMessage, AgentConfig, ExtractedIntent, GroundingContext } from './types';

export class AgentProviderError extends Error {
  override name = 'AgentProviderError';
  constructor(
    readonly code: 'agent_misconfigured' | 'provider_unavailable' | 'provider_timeout' | 'malformed_response',
    message: string,
  ) {
    super(message);
  }
}

export interface LlmProvider {
  extractIntent(
    userMessage: string,
    context: GroundingContext,
    history?: AgentChatMessage[],
  ): Promise<ExtractedIntent>;
}

export function loadAgentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const apiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const enabledStr = env.PLANRESCUE_AGENT_ENABLED?.trim();
  const enabled = enabledStr !== undefined ? enabledStr === 'true' : Boolean(apiKey);
  const model = env.PLANRESCUE_AGENT_MODEL?.trim() || 'gpt-4o-mini';
  const timeoutMs = Number(env.PLANRESCUE_AGENT_TIMEOUT_MS) || 30_000;
  const baseUrl = env.OPENAI_BASE_URL?.trim() || undefined;

  return {
    enabled,
    apiKey,
    model,
    timeoutMs: Math.max(5000, Math.min(timeoutMs, 120000)),
    baseUrl,
  };
}

export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI;
  private readonly config: AgentConfig;

  constructor(config: AgentConfig = loadAgentConfig()) {
    this.config = config;
    if (!config.apiKey) {
      throw new AgentProviderError(
        'agent_misconfigured',
        'OPENAI_API_KEY is not configured. Add it to apps/web/.env.local to enable the AI agent, or use the structured controls below.',
      );
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      maxRetries: 1,
    });
  }

  async extractIntent(
    userMessage: string,
    context: GroundingContext,
    history: AgentChatMessage[] = [],
  ): Promise<ExtractedIntent> {
    const groundingText = buildUserGroundingMessage(userMessage, context);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    for (const h of history.slice(-6)) {
      messages.push({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      });
    }

    messages.push({
      role: 'user',
      content: groundingText,
    });

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (/timeout|aborted/i.test(errorMsg)) {
        throw new AgentProviderError('provider_timeout', 'The AI agent timed out while interpreting your request.');
      }
      if (/401|invalid_api_key/i.test(errorMsg)) {
        throw new AgentProviderError('agent_misconfigured', 'The configured OPENAI_API_KEY is invalid.');
      }
      if (/429|rate_limit/i.test(errorMsg)) {
        throw new AgentProviderError('provider_unavailable', 'The AI agent is currently rate-limited. Please try again shortly.');
      }
      throw new AgentProviderError('provider_unavailable', 'The AI provider is currently unreachable.');
    }

    const rawChoice = completion.choices[0]?.message?.content;
    if (!rawChoice) {
      throw new AgentProviderError('malformed_response', 'The AI model returned an empty response.');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawChoice);
    } catch {
      throw new AgentProviderError('malformed_response', 'The AI model did not return valid JSON.');
    }

    const validation = rawExtractedIntentSchema.safeParse(parsedJson);
    if (!validation.success) {
      throw new AgentProviderError(
        'malformed_response',
        `The AI model response did not conform to the expected intent schema: ${validation.error.message}`,
      );
    }

    const data: RawExtractedIntent = validation.data;
    return {
      status: data.status,
      disruptionType: data.disruptionType ?? 'event_overrun',
      targetEventId: data.targetEventId || undefined,
      targetEventTitle: data.targetEventTitle || undefined,
      overrunMinutes: data.overrunMinutes || undefined,
      protectedEventIds: data.protectedEventIds || [],
      preference: data.preference,
      clarificationQuestion: data.clarificationQuestion || undefined,
      missingInformation: data.missingInformation || undefined,
      rationale: data.rationale,
      unsupportedReason: data.unsupportedReason || undefined,
    };
  }
}
