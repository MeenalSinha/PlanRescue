/**
 * Phase 5 Bounded AI Agent Orchestrator.
 *
 * Coordinates real MCP tool calls with LLM intent extraction:
 * 1. get_schedule & get_tasks (grounding)
 * 2. LLM intent extraction
 * 3. Deterministic intent validation
 * 4. analyze_conflicts (MCP)
 * 5. propose_recovery_plan (MCP)
 * 6. validate_recovery_plan (MCP)
 * 7. Grounded explanation generation
 */
import type { ToolActivity } from '../api';
import {
  conflictAnalysisSchema,
  planSetSchema,
  scheduleOutputSchema,
  tasksOutputSchema,
  validationResultSchema,
  type ConflictAnalysis,
  type RecoveryPlan,
  type RecoveryPlanSet,
  type ValidationResult,
} from '../contract';
import { loadServerConfig, type ServerConfig } from '../env';
import { callMcpTool } from '../mcpClient';
import { dayWindow } from '../time';
import {
  generateClarificationMessage,
  generateGroundedPlanExplanation,
  generateInfeasibleMessage,
  generateUnsupportedMessage,
} from './explanations';
import { loadAgentConfig, OpenAiProvider, type LlmProvider } from './provider';
import type {
  AgentChatMessage,
  AgentScenarioContext,
  AgentTurnData,
  ExtractedIntent,
  GroundingContext,
} from './types';

export interface RunAgentTurnOptions {
  message: string;
  date: string;
  window?: { startTime: string; endTime: string };
  history?: AgentChatMessage[];
  provider?: LlmProvider;
  serverConfig?: ServerConfig;
}

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<{
  data: AgentTurnData;
  activity: ToolActivity[];
}> {
  const serverConfig = options.serverConfig ?? loadServerConfig();
  const agentConfig = loadAgentConfig();

  const activity: ToolActivity[] = [];

  // Determine planning window
  const window = options.window ?? dayWindow(options.date, serverConfig.calendarTimeZone);

  // 1. Retrieve Schedule via MCP
  const scheduleCall = await callMcpTool(
    'get_schedule',
    { startTime: window.startTime, endTime: window.endTime },
    scheduleOutputSchema,
    (d) => `${d.count} event${d.count === 1 ? '' : 's'}`,
    serverConfig,
  );
  activity.push(scheduleCall.activity);
  const events = scheduleCall.data.events;

  // 2. Retrieve Tasks via MCP
  const tasksCall = await callMcpTool(
    'get_tasks',
    {},
    tasksOutputSchema,
    (d) => `${d.count} task${d.count === 1 ? '' : 's'}`,
    serverConfig,
  );
  activity.push(tasksCall.activity);
  const tasks = tasksCall.data.tasks;

  const groundingContext: GroundingContext = {
    date: options.date,
    timeZone: scheduleCall.data.calendarTimeZone || serverConfig.calendarTimeZone,
    window,
    events,
    tasks,
  };

  // 3. Extract Intent using LLM provider
  const provider = options.provider ?? new OpenAiProvider(agentConfig);
  const intent: ExtractedIntent = await provider.extractIntent(
    options.message,
    groundingContext,
    options.history ?? [],
  );

  // 4. Deterministic validation of extracted intent
  if (intent.status === 'unsupported') {
    return {
      data: {
        status: 'unsupported_request',
        message: generateUnsupportedMessage(intent),
        intent,
        calendarUnchanged: true,
      },
      activity,
    };
  }

  if (intent.status === 'needs_clarification' || !intent.targetEventId || !intent.overrunMinutes) {
    return {
      data: {
        status: 'needs_clarification',
        message: generateClarificationMessage(intent),
        clarificationQuestion: intent.clarificationQuestion || generateClarificationMessage(intent),
        intent,
        calendarUnchanged: true,
      },
      activity,
    };
  }

  // Verify target event exists in retrieved schedule
  const targetEvent = events.find((e) => e.id === intent.targetEventId);
  if (!targetEvent) {
    const question = `I couldn't locate the event with id "${intent.targetEventId}" in your schedule for this day. Which meeting did you mean?`;
    return {
      data: {
        status: 'needs_clarification',
        message: question,
        clarificationQuestion: question,
        intent: {
          ...intent,
          status: 'needs_clarification',
          missingInformation: 'event',
        },
        calendarUnchanged: true,
      },
      activity,
    };
  }

  // Validate overrun range
  const overrun = intent.overrunMinutes;
  if (overrun < 1 || overrun > 240) {
    const question = 'Please specify a delay between 1 and 240 minutes.';
    return {
      data: {
        status: 'needs_clarification',
        message: question,
        clarificationQuestion: question,
        intent: {
          ...intent,
          status: 'needs_clarification',
          missingInformation: 'duration',
        },
        calendarUnchanged: true,
      },
      activity,
    };
  }

  // Filter protected event IDs to real events and exclude the disrupted event
  const validProtectedIds = (intent.protectedEventIds || []).filter(
    (id) => id !== targetEvent.id && events.some((e) => e.id === id),
  );

  const scenario: AgentScenarioContext = {
    targetEventId: targetEvent.id,
    targetEventTitle: targetEvent.title,
    overrunMinutes: overrun,
    startTime: window.startTime,
    endTime: window.endTime,
    protectedEventIds: validProtectedIds,
    preference: intent.preference || 'minimal_disruption',
  };

  const disruption = {
    type: 'event_overrun' as const,
    eventId: targetEvent.id,
    overrunMinutes: overrun,
  };

  // 5. analyze_conflicts via MCP
  const analyzeCall = await callMcpTool(
    'analyze_conflicts',
    {
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      disruption,
      protectedEventIds: scenario.protectedEventIds,
    },
    conflictAnalysisSchema,
    (d) =>
      `${d.existingConflicts.length} existing, ${d.newConflicts.length} new conflict${d.newConflicts.length === 1 ? '' : 's'}`,
    serverConfig,
  );
  activity.push(analyzeCall.activity);
  const analysis: ConflictAnalysis = analyzeCall.data;

  // 6. propose_recovery_plan via MCP
  const proposeCall = await callMcpTool(
    'propose_recovery_plan',
    {
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      disruption,
      protectedEventIds: scenario.protectedEventIds,
      preferences: { optimizeFor: scenario.preference },
    },
    planSetSchema,
    (d) =>
      d.outcome === 'plans_found'
        ? `${d.candidates.length} candidate${d.candidates.length === 1 ? '' : 's'}`
        : d.outcome,
    serverConfig,
  );
  activity.push(proposeCall.activity);
  const planSet: RecoveryPlanSet = proposeCall.data;

  // Check if infeasible or no candidates returned
  if (planSet.outcome === 'infeasible' || planSet.candidates.length === 0) {
    const message = generateInfeasibleMessage(scenario, analysis, planSet);
    return {
      data: {
        status: 'no_feasible_plan',
        message,
        intent,
        analysis,
        planSet,
        scenario,
        calendarUnchanged: true,
      },
      activity,
    };
  }

  // 7. validate_recovery_plan via MCP for the top-ranked candidate
  const selectedCandidate: RecoveryPlan = planSet.candidates[0]!;
  const validateCall = await callMcpTool(
    'validate_recovery_plan',
    selectedCandidate as unknown as Record<string, unknown>,
    validationResultSchema,
    (d) => (d.isValid ? 'valid' : `${d.violations.length} violation${d.violations.length === 1 ? '' : 's'}`),
    serverConfig,
  );
  activity.push(validateCall.activity);
  const validation: ValidationResult = validateCall.data;

  // 8. Generate Grounded Explanation
  const explanationMessage = generateGroundedPlanExplanation(
    scenario,
    analysis,
    selectedCandidate,
    validation,
  );

  return {
    data: {
      status: 'plans_ready',
      message: explanationMessage,
      intent,
      analysis,
      planSet,
      selectedPlan: selectedCandidate,
      validation,
      scenario,
      calendarUnchanged: true,
    },
    activity,
  };
}
