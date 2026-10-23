// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockProvider, extractJsonFromText } from '@/lib/agent/bedrockProvider';
import { createAgentProvider } from '@/lib/agent/factory';
import { AgentProviderError, loadAgentConfig, OpenAiProvider } from '@/lib/agent/provider';
import type { AgentConfig, GroundingContext } from '@/lib/agent/types';
import { EVENTS, TASKS } from './fixtures';

const CONTEXT: GroundingContext = {
  date: '2026-10-22',
  timeZone: 'Asia/Kolkata',
  window: { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' },
  events: EVENTS,
  tasks: TASKS,
};

function makeBedrockConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: 'bedrock',
    enabled: true,
    model: 'gpt-4o-mini',
    timeoutMs: 5000,
    bedrock: {
      region: 'us-east-1',
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    },
    ...overrides,
  };
}

function mockBedrockClient(responseOrError: unknown, isError = false): BedrockRuntimeClient {
  return {
    send: vi.fn().mockImplementation(() => {
      if (isError) {
        return Promise.reject(responseOrError);
      }
      return Promise.resolve(responseOrError);
    }),
  } as unknown as BedrockRuntimeClient;
}

describe('Amazon Bedrock Provider (Phase 9)', () => {
  describe('extractJsonFromText helper', () => {
    it('parses raw valid JSON string', () => {
      const parsed = extractJsonFromText('{"status":"supported","overrunMinutes":30}');
      expect(parsed).toEqual({ status: 'supported', overrunMinutes: 30 });
    });

    it('extracts JSON enclosed within markdown code fence ```json ... ```', () => {
      const text = 'Here is the response:\n```json\n{"status":"supported","overrunMinutes":45}\n```\nHope this helps.';
      const parsed = extractJsonFromText(text);
      expect(parsed).toEqual({ status: 'supported', overrunMinutes: 45 });
    });

    it('extracts JSON enclosed within plain markdown code fence ``` ... ```', () => {
      const text = '```\n{"status":"needs_clarification","missingInformation":"duration"}\n```';
      const parsed = extractJsonFromText(text);
      expect(parsed).toEqual({ status: 'needs_clarification', missingInformation: 'duration' });
    });

    it('extracts JSON from surrounding conversational text using brace matching', () => {
      const text = 'I found the following: {"status":"unsupported","unsupportedReason":"flight delay"} thank you.';
      const parsed = extractJsonFromText(text);
      expect(parsed).toEqual({ status: 'unsupported', unsupportedReason: 'flight delay' });
    });

    it('throws when no valid JSON structure is found', () => {
      expect(() => extractJsonFromText('No JSON here at all')).toThrow(/No valid JSON/);
    });
  });

  describe('BedrockProvider inference and intent extraction', () => {
    it('extracts valid supported intent from Bedrock Converse response', async () => {
      const mockResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                text: JSON.stringify({
                  status: 'supported',
                  disruptionType: 'event_overrun',
                  targetEventId: 'evt-001',
                  targetEventTitle: 'Team Meeting',
                  overrunMinutes: 40,
                  protectedEventIds: ['evt-005'],
                  preference: 'minimal_disruption',
                  rationale: 'Team meeting running late by 40 minutes.',
                }),
              },
            ],
          },
        },
      };

      const client = mockBedrockClient(mockResponse);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      const intent = await provider.extractIntent('Team meeting running 40 min late', CONTEXT);
      expect(intent.status).toBe('supported');
      expect(intent.disruptionType).toBe('event_overrun');
      expect(intent.targetEventId).toBe('evt-001');
      expect(intent.targetEventTitle).toBe('Team Meeting');
      expect(intent.overrunMinutes).toBe(40);
      expect(intent.protectedEventIds).toEqual(['evt-005']);
      expect(intent.preference).toBe('minimal_disruption');
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('handles requests requiring clarification', async () => {
      const mockResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                text: JSON.stringify({
                  status: 'needs_clarification',
                  clarificationQuestion: 'Which meeting is running late?',
                  missingInformation: 'event',
                  preference: 'minimal_disruption',
                  rationale: 'User did not name the delayed event.',
                }),
              },
            ],
          },
        },
      };

      const client = mockBedrockClient(mockResponse);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      const intent = await provider.extractIntent('My meeting is running late', CONTEXT);
      expect(intent.status).toBe('needs_clarification');
      expect(intent.clarificationQuestion).toBe('Which meeting is running late?');
      expect(intent.missingInformation).toBe('event');
    });

    it('handles unsupported disruption requests', async () => {
      const mockResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                text: JSON.stringify({
                  status: 'unsupported',
                  unsupportedReason: 'Traffic delays are not yet supported.',
                  preference: 'minimal_disruption',
                  rationale: 'Travel disruptions are outside current scope.',
                }),
              },
            ],
          },
        },
      };

      const client = mockBedrockClient(mockResponse);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      const intent = await provider.extractIntent('I am stuck in traffic for 2 hours', CONTEXT);
      expect(intent.status).toBe('unsupported');
      expect(intent.unsupportedReason).toBe('Traffic delays are not yet supported.');
    });

    it('throws malformed_response when model returns empty message content', async () => {
      const mockResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [],
          },
        },
      };

      const client = mockBedrockClient(mockResponse);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toThrowError(AgentProviderError);
      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'malformed_response',
      });
    });

    it('throws malformed_response when model returns non-JSON text', async () => {
      const mockResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'I apologize, but I cannot assist with scheduling today.' }],
          },
        },
      };

      const client = mockBedrockClient(mockResponse);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'malformed_response',
      });
    });

    it('throws malformed_response when JSON fails Zod schema validation', async () => {
      const mockResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [{ text: JSON.stringify({ foo: 'bar' }) }],
          },
        },
      };

      const client = mockBedrockClient(mockResponse);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'malformed_response',
      });
    });

    it('maps AWS timeout errors to provider_timeout', async () => {
      const timeoutError = new Error('Request aborted due to timeout');
      timeoutError.name = 'AbortError';

      const client = mockBedrockClient(timeoutError, true);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'provider_timeout',
      });
    });

    it('maps AWS missing credentials to agent_misconfigured', async () => {
      const credsError = new Error('Could not load credentials from any providers');
      credsError.name = 'CredentialsProviderError';

      const client = mockBedrockClient(credsError, true);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'agent_misconfigured',
      });
    });

    it('maps AWS AccessDeniedException to agent_misconfigured without leaking keys', async () => {
      const authError = new Error('User is not authorized to perform: bedrock:InvokeModel on resource');
      authError.name = 'AccessDeniedException';

      const client = mockBedrockClient(authError, true);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'agent_misconfigured',
      });
    });

    it('maps AWS ThrottlingException to provider_unavailable', async () => {
      const throttleError = new Error('Too many requests, rate limit exceeded');
      throttleError.name = 'ThrottlingException';

      const client = mockBedrockClient(throttleError, true);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
    });

    it('maps ResourceNotFoundException to agent_misconfigured', async () => {
      const notFoundError = new Error('The requested model was not found');
      notFoundError.name = 'ResourceNotFoundException';

      const client = mockBedrockClient(notFoundError, true);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'agent_misconfigured',
      });
    });
  });

  describe('Provider selection and factory', () => {
    it('defaults to OpenAI when PLANRESCUE_AGENT_PROVIDER is unset', () => {
      const config = loadAgentConfig({ OPENAI_API_KEY: 'test-key' });
      expect(config.provider).toBe('openai');
      const provider = createAgentProvider(config);
      expect(provider).toBeInstanceOf(OpenAiProvider);
    });

    it('selects OpenAI when explicitly configured', () => {
      const config = loadAgentConfig({
        PLANRESCUE_AGENT_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
      });
      expect(config.provider).toBe('openai');
      const provider = createAgentProvider(config);
      expect(provider).toBeInstanceOf(OpenAiProvider);
    });

    it('selects Bedrock when explicitly configured', () => {
      const config = loadAgentConfig({
        PLANRESCUE_AGENT_PROVIDER: 'bedrock',
        AWS_REGION: 'us-west-2',
        BEDROCK_MODEL_ID: 'amazon.nova-micro-v1:0',
      });
      expect(config.provider).toBe('bedrock');
      expect(config.bedrock.region).toBe('us-west-2');
      expect(config.bedrock.modelId).toBe('amazon.nova-micro-v1:0');
      const provider = createAgentProvider(config);
      expect(provider).toBeInstanceOf(BedrockProvider);
    });

    it('does not require OPENAI_API_KEY when Bedrock is selected', () => {
      const config = loadAgentConfig({
        PLANRESCUE_AGENT_PROVIDER: 'bedrock',
        AWS_REGION: 'us-east-1',
      });
      expect(config.apiKey).toBeUndefined();
      expect(config.enabled).toBe(true);
      expect(() => createAgentProvider(config)).not.toThrow();
    });

    it('does not require AWS credentials when OpenAI is selected', () => {
      const config = loadAgentConfig({
        PLANRESCUE_AGENT_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
      });
      expect(config.provider).toBe('openai');
      expect(config.apiKey).toBe('test-key');
    });

    it('rejects unsupported provider names with agent_misconfigured', () => {
      expect(() =>
        loadAgentConfig({
          PLANRESCUE_AGENT_PROVIDER: 'unsupported-llm',
        }),
      ).toThrowError(AgentProviderError);
    });

    it('fails clearly when Bedrock region is empty', () => {
      const config = makeBedrockConfig({
        bedrock: { region: '', modelId: 'test-model' },
      });
      expect(() => new BedrockProvider(config)).toThrowError(AgentProviderError);
    });

    it('never silently switches from Bedrock to OpenAI on failure', async () => {
      const client = mockBedrockClient(new Error('Network error'), true);
      const provider = new BedrockProvider(makeBedrockConfig(), client);

      await expect(provider.extractIntent('test', CONTEXT)).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
    });
  });

  describe('API Route POST /api/agent/turn with Bedrock provider', () => {
    it('does not require OPENAI_API_KEY when Bedrock is the configured provider', async () => {
      const { POST: agentTurnPOST } = await import('@/app/api/agent/turn/route');

      const oldProvider = process.env.PLANRESCUE_AGENT_PROVIDER;
      const oldKey = process.env.OPENAI_API_KEY;
      const oldRegion = process.env.AWS_REGION;

      process.env.PLANRESCUE_AGENT_PROVIDER = 'bedrock';
      delete process.env.OPENAI_API_KEY;
      process.env.AWS_REGION = 'us-east-1';

      const req = new Request('http://localhost/api/agent/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'My team meeting is running 40 minutes late.',
          date: '2026-10-22',
        }),
      });

      try {
        const res = await agentTurnPOST(req);
        const json = await res.json();
        // Since MCP server isn't running in this unit test or AWS credentials aren't set,
        // it may fail with mcp_unreachable or provider_unavailable, but NEVER with missing OPENAI_API_KEY
        expect(json.error?.message).not.toContain('OPENAI_API_KEY');
      } finally {
        if (oldProvider !== undefined) process.env.PLANRESCUE_AGENT_PROVIDER = oldProvider;
        else delete process.env.PLANRESCUE_AGENT_PROVIDER;
        if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
        if (oldRegion !== undefined) process.env.AWS_REGION = oldRegion;
        else delete process.env.AWS_REGION;
      }
    });

    it('returns misconfigured if Bedrock is selected but required AWS_REGION is empty', async () => {
      const { POST: agentTurnPOST } = await import('@/app/api/agent/turn/route');

      const oldProvider = process.env.PLANRESCUE_AGENT_PROVIDER;
      const oldRegion = process.env.AWS_REGION;
      const oldDefRegion = process.env.AWS_DEFAULT_REGION;

      process.env.PLANRESCUE_AGENT_PROVIDER = 'bedrock';
      process.env.AWS_REGION = '';
      process.env.AWS_DEFAULT_REGION = '';

      const req = new Request('http://localhost/api/agent/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'My team meeting is running 40 minutes late.',
          date: '2026-10-22',
        }),
      });

      try {
        const res = await agentTurnPOST(req);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error.code).toBe('misconfigured');
        expect(json.error.message).toContain('AWS_REGION');
      } finally {
        if (oldProvider !== undefined) process.env.PLANRESCUE_AGENT_PROVIDER = oldProvider;
        else delete process.env.PLANRESCUE_AGENT_PROVIDER;
        if (oldRegion !== undefined) process.env.AWS_REGION = oldRegion;
        else delete process.env.AWS_REGION;
        if (oldDefRegion !== undefined) process.env.AWS_DEFAULT_REGION = oldDefRegion;
        else delete process.env.AWS_DEFAULT_REGION;
      }
    });
  });
});
