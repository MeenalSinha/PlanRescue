/**
 * Phase 5: AI Agent types and contracts.
 * All scheduling remains read-only through the 5 existing MCP tools.
 */
import type { ConflictAnalysis, Priority, RecoveryPlan, RecoveryPlanSet, ScheduleEvent, Task, ValidationResult } from '../contract';
import type { ToolActivity } from '../api';

export type DisruptionType = 'event_overrun';
export type RankingPreference = 'minimal_disruption' | 'transition_time';

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ExtractedIntentStatus = 'supported' | 'needs_clarification' | 'unsupported';
export type MissingInfoReason = 'event' | 'duration' | 'window' | 'ambiguous_match' | 'other';

export interface ExtractedIntent {
  status: ExtractedIntentStatus;
  disruptionType?: DisruptionType;
  targetEventId?: string;
  targetEventTitle?: string;
  overrunMinutes?: number;
  protectedEventIds: string[];
  preference: RankingPreference;
  clarificationQuestion?: string;
  missingInformation?: MissingInfoReason;
  rationale: string;
  unsupportedReason?: string;
}

export interface AgentScenarioContext {
  targetEventId: string;
  targetEventTitle: string;
  overrunMinutes: number;
  startTime: string;
  endTime: string;
  protectedEventIds: string[];
  preference: RankingPreference;
}

export type AgentTurnStatus =
  | 'plans_ready'
  | 'no_feasible_plan'
  | 'analysis_ready'
  | 'needs_clarification'
  | 'unsupported_request'
  | 'agent_error';

export interface AgentTurnData {
  status: AgentTurnStatus;
  message: string;
  intent?: ExtractedIntent;
  analysis?: ConflictAnalysis;
  planSet?: RecoveryPlanSet;
  selectedPlan?: RecoveryPlan;
  validation?: ValidationResult;
  clarificationQuestion?: string;
  scenario?: AgentScenarioContext;
  /** Explicit safety indicator: Phase 5 is strictly read-only. */
  calendarUnchanged: true;
}

export type AgentProviderType = 'openai' | 'bedrock';

export interface BedrockConfig {
  region: string;
  modelId: string;
  profile?: string;
}

export interface AgentConfig {
  provider: AgentProviderType;
  enabled: boolean;
  model: string;
  timeoutMs: number;
  apiKey?: string;
  baseUrl?: string;
  bedrock: BedrockConfig;
}

export interface GroundingContext {
  date: string;
  timeZone: string;
  window: { startTime: string; endTime: string };
  events: ScheduleEvent[];
  tasks: Task[];
}
