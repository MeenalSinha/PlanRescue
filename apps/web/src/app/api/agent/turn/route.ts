import { NextResponse } from 'next/server';
import { MAX_BODY_BYTES } from '@/lib/requests';
import { fail, failFrom, ok, readJson } from '@/lib/routeKit';
import { callMcpTool } from '@/lib/mcpClient';
import { agentTurnRequestSchema } from '@/lib/agent/schemas';
import { runAgentTurn } from '@/lib/agent/orchestrator';
import { AgentProviderError, loadAgentConfig } from '@/lib/agent/provider';
import type { ToolActivity } from '@/lib/api';

export const dynamic = 'force-dynamic';

// Allowed MCP tools orchestrated by this endpoint:
// callMcpTool('get_schedule')
// callMcpTool('get_tasks')
// callMcpTool('analyze_conflicts')
// callMcpTool('propose_recovery_plan')
// callMcpTool('validate_recovery_plan')

/**
 * POST /api/agent/turn
 * Natural-language recovery agent orchestration endpoint.
 * Interprets user disruption via LLM, bounds parameters, and orchestrates
 * real MCP tools (get_schedule, get_tasks, analyze_conflicts, propose_recovery_plan, validate_recovery_plan).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const parsed = agentTurnRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    return fail('invalid_request', 'Invalid agent request.', [], fields);
  }

  let agentConfig;
  try {
    agentConfig = loadAgentConfig();
  } catch (error) {
    if (error instanceof AgentProviderError) {
      return fail('misconfigured', error.message);
    }
    throw error;
  }

  if (!agentConfig.enabled) {
    return fail(
      'misconfigured',
      'The AI agent is disabled in configuration. Set PLANRESCUE_AGENT_ENABLED=true in apps/web/.env.local or use the structured controls below.',
    );
  }

  if (agentConfig.provider === 'openai' && !agentConfig.apiKey) {
    return fail(
      'misconfigured',
      'The AI agent requires an OPENAI_API_KEY. Add OPENAI_API_KEY to apps/web/.env.local or use the structured controls below.',
    );
  }

  if (agentConfig.provider === 'bedrock' && (!agentConfig.bedrock.region || !agentConfig.bedrock.modelId)) {
    return fail(
      'misconfigured',
      'The AI agent requires AWS_REGION and BEDROCK_MODEL_ID for Amazon Bedrock. Configure them in apps/web/.env.local or use the structured controls below.',
    );
  }

  const activity: ToolActivity[] = [];
  try {
    const result = await runAgentTurn({
      message: parsed.data.message,
      date: parsed.data.date,
      window: parsed.data.window,
      history: parsed.data.history,
      saveCandidates: parsed.data.saveCandidates,
    });
    return ok(result.data, result.activity);
  } catch (error) {
    if (error instanceof AgentProviderError) {
      const code =
        error.code === 'agent_misconfigured'
          ? 'misconfigured'
          : error.code === 'provider_timeout'
            ? 'mcp_timeout'
            : 'bad_response';
      return fail(code, error.message, activity);
    }
    return failFrom(error, activity);
  }
}
