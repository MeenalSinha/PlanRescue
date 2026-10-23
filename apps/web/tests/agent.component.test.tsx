import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentChat } from '@/components/AgentChat';
import type { AgentTurnData } from '@/lib/agent/types';
import type { Remote } from '@/lib/useRecoveryApp';

describe('AgentChat Component', () => {
  it('renders conversational input with the expected placeholder and suggestions', () => {
    render(
      <AgentChat
        history={[]}
        turn={{ status: 'idle' }}
        busy={false}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('Tell PlanRescue what changed in your day...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My team meeting is running 40 minutes late/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('clicking a suggested prompt fills the input', async () => {
    const user = userEvent.setup();
    render(
      <AgentChat
        history={[]}
        turn={{ status: 'idle' }}
        busy={false}
        onSend={vi.fn()}
      />,
    );

    const suggestion = screen.getByRole('button', { name: /My team meeting is running 40 minutes late/ });
    await user.click(suggestion);

    const input = screen.getByPlaceholderText('Tell PlanRescue what changed in your day...');
    expect(input).toHaveValue('My team meeting is running 40 minutes late. Fix my afternoon.');
  });

  it('submits typed message and clears input', async () => {
    const user = userEvent.setup();
    const handleSend = vi.fn();
    render(
      <AgentChat
        history={[]}
        turn={{ status: 'idle' }}
        busy={false}
        onSend={handleSend}
      />,
    );

    const input = screen.getByPlaceholderText('Tell PlanRescue what changed in your day...');
    await user.type(input, 'My doctor appointment moved to 5pm');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(handleSend).toHaveBeenCalledWith('My doctor appointment moved to 5pm');
    expect(input).toHaveValue('');
  });

  it('disables input and send button when busy', () => {
    render(
      <AgentChat
        history={[]}
        turn={{ status: 'loading' }}
        busy={true}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('Tell PlanRescue what changed in your day...')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByText('Interpreting request and orchestrating MCP tools…')).toBeInTheDocument();
  });

  it('displays conversation history for user and assistant turns', () => {
    const history = [
      { role: 'user' as const, content: 'My team meeting is running late.' },
      { role: 'assistant' as const, content: 'How many minutes is the team meeting delayed?' },
      { role: 'user' as const, content: 'It is delayed by 40 minutes.' },
    ];

    render(
      <AgentChat
        history={history}
        turn={{ status: 'idle' }}
        busy={false}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText('My team meeting is running late.')).toBeInTheDocument();
    expect(screen.getByText('How many minutes is the team meeting delayed?')).toBeInTheDocument();
    expect(screen.getByText('It is delayed by 40 minutes.')).toBeInTheDocument();
  });

  it('displays Recovery Plan Ready status badge and summary when turn succeeds', () => {
    const turnData: AgentTurnData = {
      status: 'plans_ready',
      message: 'Understood: Team meeting is running 40 minutes late. Proposed 1 valid recovery plan.',
      calendarUnchanged: true,
    };

    render(
      <AgentChat
        history={[]}
        turn={{ status: 'ready', data: turnData }}
        busy={false}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText('Recovery Plan Ready')).toBeInTheDocument();
    expect(screen.getByText(/Independently validated · Calendar unchanged/)).toBeInTheDocument();
    expect(screen.getByText(/Team meeting is running 40 minutes late/)).toBeInTheDocument();
  });

  it('displays Clarification Needed badge when turn asks for clarification', () => {
    const turnData: AgentTurnData = {
      status: 'needs_clarification',
      message: 'Which meeting is running late, and by how many minutes?',
      clarificationQuestion: 'Which meeting is running late, and by how many minutes?',
      calendarUnchanged: true,
    };

    render(
      <AgentChat
        history={[]}
        turn={{ status: 'ready', data: turnData }}
        busy={false}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText('Clarification Needed')).toBeInTheDocument();
    expect(screen.getByText('Which meeting is running late, and by how many minutes?')).toBeInTheDocument();
  });

  it('displays error notice and switch to structured form button when misconfigured', async () => {
    const user = userEvent.setup();
    const handleSwitch = vi.fn();

    render(
      <AgentChat
        history={[]}
        turn={{
          status: 'error',
          error: {
            code: 'misconfigured',
            message: 'OPENAI_API_KEY is not configured.',
          },
        }}
        busy={false}
        onSend={vi.fn()}
        onSwitchToStructured={handleSwitch}
      />,
    );

    expect(screen.getByText('The AI agent encountered an issue')).toBeInTheDocument();
    expect(screen.getByText('OPENAI_API_KEY is not configured.')).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: 'Switch to structured form' });
    await user.click(switchBtn);
    expect(handleSwitch).toHaveBeenCalledTimes(1);
  });
});
