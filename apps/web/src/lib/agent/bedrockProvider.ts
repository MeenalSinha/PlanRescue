/**
 * Real Amazon Bedrock foundation model adapter using the official AWS SDK v3 Bedrock Runtime.
 *
 * Implements structured intent extraction via the Bedrock Converse API, with Zod schema
 * validation, timeouts, and safe error handling that never exposes AWS credentials or secrets.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type BedrockRuntimeClientConfig,
} from '@aws-sdk/client-bedrock-runtime';
import { AgentProviderError, loadAgentConfig, type LlmProvider } from './provider';
import { rawExtractedIntentSchema, type RawExtractedIntent } from './schemas';
import { SYSTEM_PROMPT, buildUserGroundingMessage } from './systemPrompt';
import type { AgentChatMessage, AgentConfig, ExtractedIntent, GroundingContext } from './types';

/**
 * Robust JSON extractor for LLM textual output.
 * Handles clean JSON, markdown code fence blocks (```json ... ```), and raw braced content.
 */
export function extractJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Attempt extracting from markdown code block ```json ... ``` or ``` ... ```
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch?.[1]) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // Fall through to brace extraction
      }
    }

    // Attempt extracting from outermost braces
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('No valid JSON object structure found in response.');
  }
}

export class BedrockProvider implements LlmProvider {
  private readonly client: BedrockRuntimeClient;
  private readonly config: AgentConfig;

  constructor(config: AgentConfig = loadAgentConfig(), client?: BedrockRuntimeClient) {
    this.config = config;

    if (!config.bedrock.region) {
      throw new AgentProviderError(
        'agent_misconfigured',
        'AWS_REGION is not configured for Amazon Bedrock. Set AWS_REGION in apps/web/.env.local.',
      );
    }
    if (!config.bedrock.modelId) {
      throw new AgentProviderError(
        'agent_misconfigured',
        'BEDROCK_MODEL_ID is not configured for Amazon Bedrock. Set BEDROCK_MODEL_ID in apps/web/.env.local.',
      );
    }

    if (client) {
      this.client = client;
    } else {
      const clientConfig: BedrockRuntimeClientConfig = {
        region: config.bedrock.region,
      };
      if (config.bedrock.profile) {
        // If an explicit profile is configured, AWS SDK supports AWS_PROFILE or profile in credentials
        process.env.AWS_PROFILE = config.bedrock.profile;
      }
      this.client = new BedrockRuntimeClient(clientConfig);
    }
  }

  async extractIntent(
    userMessage: string,
    context: GroundingContext,
    history: AgentChatMessage[] = [],
  ): Promise<ExtractedIntent> {
    const groundingText = buildUserGroundingMessage(userMessage, context);

    // Build Converse messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }> = [];

    // Include bounded history (last 6 messages)
    for (const h of history.slice(-6)) {
      messages.push({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: h.content }],
      });
    }

    // Append current grounded user message
    messages.push({
      role: 'user',
      content: [{ text: groundingText }],
    });

    const command = new ConverseCommand({
      modelId: this.config.bedrock.modelId,
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      inferenceConfig: {
        temperature: 0.1,
        maxTokens: 2048,
      },
    });

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.config.timeoutMs);

    let response;
    try {
      response = await this.client.send(command, { abortSignal: abortController.signal });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : '';

      if (abortController.signal.aborted || /timeout|aborted/i.test(errorMsg) || errorName === 'AbortError') {
        throw new AgentProviderError(
          'provider_timeout',
          'The Amazon Bedrock AI agent timed out while interpreting your request.',
        );
      }

      if (
        /Credentials|UnrecognizedClientException|InvalidSignatureException|AuthFailure/i.test(errorMsg) ||
        errorName === 'CredentialsProviderError'
      ) {
        throw new AgentProviderError(
          'agent_misconfigured',
          'AWS credentials are missing or could not be verified for Amazon Bedrock.',
        );
      }

      if (/AccessDenied|Unauthorized/i.test(errorMsg) || errorName === 'AccessDeniedException') {
        throw new AgentProviderError(
          'agent_misconfigured',
          'AWS authorization failed: Your AWS credentials lack bedrock:InvokeModel permission.',
        );
      }

      if (/ResourceNotFound|model/i.test(errorMsg) || errorName === 'ResourceNotFoundException') {
        throw new AgentProviderError(
          'agent_misconfigured',
          `The configured Bedrock model "${this.config.bedrock.modelId}" was not found or is inaccessible in region "${this.config.bedrock.region}".`,
        );
      }

      if (/Throttling|TooManyRequests/i.test(errorMsg) || errorName === 'ThrottlingException') {
        throw new AgentProviderError(
          'provider_unavailable',
          'Amazon Bedrock is currently rate-limited. Please try again shortly.',
        );
      }

      throw new AgentProviderError(
        'provider_unavailable',
        'Amazon Bedrock is currently unreachable. Please verify your connection or AWS region.',
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const rawChoice = response.output?.message?.content
      ?.map((c) => c.text ?? '')
      .join('')
      .trim();

    if (!rawChoice) {
      throw new AgentProviderError('malformed_response', 'The Amazon Bedrock model returned an empty response.');
    }

    let parsedJson: unknown;
    try {
      parsedJson = extractJsonFromText(rawChoice);
    } catch {
      throw new AgentProviderError('malformed_response', 'The Amazon Bedrock model did not return valid JSON.');
    }

    const validation = rawExtractedIntentSchema.safeParse(parsedJson);
    if (!validation.success) {
      throw new AgentProviderError(
        'malformed_response',
        `The Amazon Bedrock model response did not conform to the expected intent schema: ${validation.error.message}`,
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
