'use client';

import { useState, type FormEvent } from 'react';
import type { AgentChatMessage, AgentTurnData } from '@/lib/agent/types';
import type { Remote } from '@/lib/useRecoveryApp';
import { Notice, Spinner } from './ui';

export interface AgentChatProps {
  history: AgentChatMessage[];
  turn: Remote<AgentTurnData>;
  busy: boolean;
  onSend: (message: string) => void;
  onSwitchToStructured?: () => void;
}

const EXAMPLE_PROMPTS = [
  'My team meeting is running 40 minutes late. Fix my afternoon.',
  'My meeting is delayed by 30 minutes. Don\'t move my doctor\'s appointment.',
  'Find a recovery plan that minimizes changes to my schedule.',
] as const;

export function AgentChat({ history, turn, busy, onSend, onSwitchToStructured }: AgentChatProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setInput('');
  };

  const handleSelectExample = (prompt: string) => {
    if (busy) return;
    setInput(prompt);
  };

  return (
    <div className="agent-chat-container">
      <div className="agent-chat-header">
        <div>
          <p className="agent-chat-tagline">
            Describe what changed in your day. PlanRescue will retrieve your schedule, identify conflicts, and generate validated recovery plans.
          </p>
        </div>
        {onSwitchToStructured ? (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={onSwitchToStructured}
          >
            Use structured controls instead
          </button>
        ) : null}
      </div>

      <div className="agent-prompt-suggestions" aria-label="Suggested prompts">
        <span className="small muted">Try:</span>
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="suggestion-pill"
            onClick={() => handleSelectExample(prompt)}
            disabled={busy}
          >
            &ldquo;{prompt}&rdquo;
          </button>
        ))}
      </div>

      {history.length > 0 ? (
        <div className="agent-history-list" aria-label="Conversation history">
          {history.map((msg, index) => (
            <div
              key={index}
              className={`agent-message-bubble ${msg.role === 'user' ? 'agent-message-user' : 'agent-message-assistant'}`}
            >
              <span className="agent-message-role">{msg.role === 'user' ? 'You' : 'PlanRescue'}</span>
              <p className="agent-message-text">{msg.content}</p>
            </div>
          ))}
        </div>
      ) : null}

      {turn.status === 'loading' ? (
        <div className="agent-thinking-card" aria-live="polite">
          <Spinner label="Interpreting request and orchestrating MCP tools…" />
          <p className="muted small">
            Retrieving schedule & tasks → Analyzing conflicts → Generating recovery plans → Independently validating
          </p>
        </div>
      ) : null}

      {turn.status === 'error' ? (
        <Notice
          tone="danger"
          live="assertive"
          title="The AI agent encountered an issue"
          action={
            onSwitchToStructured ? (
              <button type="button" className="btn btn-small" onClick={onSwitchToStructured}>
                Switch to structured form
              </button>
            ) : undefined
          }
        >
          <p>{turn.error.message}</p>
          {turn.error.code === 'misconfigured' ? (
            <p className="small muted">
              Tip: You can add <code>OPENAI_API_KEY</code> to <code>apps/web/.env.local</code> to enable natural-language recovery, or use the manual controls below.
            </p>
          ) : null}
        </Notice>
      ) : null}

      {turn.status === 'ready' ? (
        <div className="agent-latest-result">
          {turn.data.status === 'plans_ready' ? (
            <div className="agent-badge-row">
              <span className="badge badge-success">Recovery Plan Ready</span>
              <span className="small muted">Independently validated · Calendar unchanged</span>
            </div>
          ) : turn.data.status === 'needs_clarification' ? (
            <div className="agent-badge-row">
              <span className="badge badge-warning">Clarification Needed</span>
              <span className="small muted">Please reply below</span>
            </div>
          ) : turn.data.status === 'no_feasible_plan' ? (
            <div className="agent-badge-row">
              <span className="badge badge-danger">No Feasible Plan</span>
              <span className="small muted">Constraints prevented recovery</span>
            </div>
          ) : (
            <div className="agent-badge-row">
              <span className="badge">{turn.data.status.replace('_', ' ')}</span>
            </div>
          )}

          <p className="agent-response-summary">{turn.data.message}</p>
        </div>
      ) : null}

      <form className="agent-chat-form" onSubmit={handleSubmit}>
        <div className="agent-input-group">
          <label htmlFor="agent-chat-input" className="sr-only">
            Describe what changed in your day
          </label>
          <input
            id="agent-chat-input"
            type="text"
            className="agent-chat-input"
            placeholder="Tell PlanRescue what changed in your day..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !input.trim()}
          >
            {busy ? <Spinner label="Sending…" /> : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
