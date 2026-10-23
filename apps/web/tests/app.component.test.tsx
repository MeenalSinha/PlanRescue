import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/components/App';
import type { ApiResponse } from '@/lib/api';
import { analysisWithConflict, dashboardOk, emptyAnalysis, errResponse, okResponse, plan, planSet, validation } from './fixtures';

type Handler = (body: unknown) => ApiResponse<unknown> | Promise<ApiResponse<unknown>> | 'network-error';
interface Calls {
  url: string;
  body: unknown;
}
let calls: Calls[];
let handlers: Record<string, Handler>;

function installFetch(): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: url.pathname, body });
      const handler = handlers[url.pathname];
      if (!handler) throw new Error(`Unexpected request to ${url.pathname}`);
      const result = await handler(body);
      if (result === 'network-error') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
    }),
  );
}

const callsTo = (path: string): Calls[] => calls.filter((c) => c.url === path);

beforeEach(() => {
  handlers = { '/api/dashboard': () => dashboardOk() };
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loaded(): Promise<ReturnType<typeof userEvent.setup>> {
  render(<App />);
  await screen.findByRole('list', { name: 'Tasks and deadlines' });
  return userEvent.setup();
}

async function fillAndAnalyze(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(screen.getByLabelText('Event that ran late'), 'evt-001');
  await user.click(screen.getByRole('button', { name: '40 min' }));
  await user.click(screen.getByRole('checkbox', { name: /Doctor's Appointment/ }));
  await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));
}

describe('dashboard', () => {
  it('shows events, tasks and a connected status from the MCP results', async () => {
    await loaded();
    expect(screen.getAllByText('Team Meeting').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('list', { name: 'Tasks and deadlines' })).getByText('Prepare for project review')).toBeInTheDocument();
    expect(screen.getAllByText('MCP server connected').length).toBeGreaterThan(0);
    expect(screen.getByText('Sample development data')).toBeInTheDocument();
    expect(screen.getByText(/Thu 22 Oct 2026 · Asia\/Kolkata \(UTC\+05:30\)/)).toBeInTheDocument();
    // The activity roster is built from the real call records that came back.
    const roster = screen.getByRole('complementary');
    expect(within(roster).getAllByText('4 events').length).toBeGreaterThan(0);
    expect(within(roster).getAllByText('Not called yet')).toHaveLength(2);
  });

  it('distinguishes fixed from movable events', async () => {
    await loaded();
    const schedule = screen.getByRole('list', { name: 'Schedule for the day' });
    expect(within(schedule).getAllByText('Fixed').length).toBeGreaterThan(0);
    expect(within(schedule).getAllByText('Movable').length).toBeGreaterThan(0);
  });

  it('shows an empty state when there are no events', async () => {
    handlers['/api/dashboard'] = () => dashboardOk({ events: [] });
    render(<App />);
    expect(await screen.findByText('No events are scheduled for this day.')).toBeInTheDocument();
    expect(screen.getByLabelText('Event that ran late')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Analyze disruption' })).toBeDisabled();
  });

  it('shows an empty state when there are no tasks', async () => {
    handlers['/api/dashboard'] = () => dashboardOk({ tasks: [] });
    render(<App />);
    expect(await screen.findByText('No tasks are due in this period.')).toBeInTheDocument();
  });

  it('explains how to start the backend when the MCP server is unavailable, and retries', async () => {
    let up = false;
    handlers['/api/dashboard'] = () => (up ? dashboardOk() : errResponse('mcp_unavailable', 'The PlanRescue MCP server is not reachable.', 'get_schedule'));
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Can’t reach the PlanRescue MCP server')).toBeInTheDocument();
    expect(within(alert).getByText('npm run dev:mcp')).toBeInTheDocument();
    expect(screen.getByText('MCP server temporarily unavailable', { selector: '.topbar *' })).toBeInTheDocument();
    expect(screen.queryByText('MCP server connected')).not.toBeInTheDocument();
    // No fabricated data is shown in place of the real result.
    expect(screen.queryByText('Team Meeting')).not.toBeInTheDocument();

    up = true;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Tasks and deadlines' })).toBeInTheDocument();
    expect(callsTo('/api/dashboard')).toHaveLength(2);
    expect(screen.getAllByText('MCP server connected').length).toBeGreaterThan(0);
  });

  it('keeps the form values and the last good data when a refresh fails', async () => {
    const user = await loaded();
    const overrun = screen.getByLabelText('Minutes late');
    await user.clear(overrun);
    await user.type(overrun, '55');
    handlers['/api/dashboard'] = () => errResponse('mcp_timeout', 'The PlanRescue MCP server did not respond in time.', 'get_schedule');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not respond in time');
    expect(screen.getByLabelText('Minutes late')).toHaveValue(55);
    expect(screen.getByText(/last data that loaded successfully/)).toBeInTheDocument();
  });

  it('reports a network failure reaching the web server itself', async () => {
    handlers['/api/dashboard'] = () => 'network-error';
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the PlanRescue web server');
  });

  it('reports an unreadable server response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 502 })));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not read');
  });
});

describe('disruption form', () => {
  it('blocks an invalid submission and explains the fields, without calling the server', async () => {
    const user = await loaded();
    await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));
    const select = screen.getByLabelText('Event that ran late');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Choose the event that ran late');
    expect(callsTo('/api/recovery/analyze')).toHaveLength(0);
  });

  it('validates the overrun range', async () => {
    const user = await loaded();
    await user.selectOptions(screen.getByLabelText('Event that ran late'), 'evt-001');
    const overrun = screen.getByLabelText('Minutes late');
    await user.clear(overrun);
    await user.type(overrun, '500');
    await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));
    expect(screen.getByText('The overrun can be at most 240 minutes')).toBeInTheDocument();
    await user.clear(overrun);
    await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));
    expect(screen.getByText('Enter the overrun as a whole number of minutes')).toBeInTheDocument();
    expect(callsTo('/api/recovery/analyze')).toHaveLength(0);
  });

  it('rejects a window that ends before it starts', async () => {
    const user = await loaded();
    await user.selectOptions(screen.getByLabelText('Event that ran late'), 'evt-001');
    const end = screen.getByLabelText('Window ends');
    await user.clear(end);
    await user.type(end, '2026-10-22T07:00');
    await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));
    expect(await screen.findByText('The window must end after it starts')).toBeInTheDocument();
    expect(callsTo('/api/recovery/analyze')).toHaveLength(0);
  });

  it('offers only the events from get_schedule and the supported disruption type', async () => {
    await loaded();
    const options = within(screen.getByLabelText('Event that ran late')).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options).toEqual(['', 'evt-001', 'evt-002', 'evt-003', 'evt-005']);
    expect(screen.getByLabelText('Disruption type')).toBeDisabled();
  });

  it('sends a correctly formatted request with the chosen event, delay and protected events', async () => {
    handlers['/api/recovery/analyze'] = () => okResponse(analysisWithConflict(), 'analyze_conflicts');
    const user = await loaded();
    await fillAndAnalyze(user);
    await screen.findByText('Caused by this disruption (1)');
    expect(callsTo('/api/recovery/analyze')[0]!.body).toEqual({
      startTime: '2026-10-22T08:00:00+05:30',
      endTime: '2026-10-22T20:00:00+05:30',
      disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
      protectedEventIds: ['evt-005'],
    });
  });

  it('does not let the late event also be protected', async () => {
    const user = await loaded();
    await user.selectOptions(screen.getByLabelText('Event that ran late'), 'evt-001');
    expect(screen.queryByRole('checkbox', { name: /Team Meeting/ })).not.toBeInTheDocument();
  });
});

describe('conflict analysis', () => {
  it('separates new from pre-existing conflicts, with severity as text', async () => {
    handlers['/api/recovery/analyze'] = () => okResponse(analysisWithConflict(), 'analyze_conflicts');
    const user = await loaded();
    await fillAndAnalyze(user);
    const newHeading = await screen.findByText('Caused by this disruption (1)');
    const newCol = newHeading.parentElement!;
    expect(within(newCol).getByText(/overlaps Lunch Break/)).toBeInTheDocument();
    expect(within(newCol).getByText(/High/)).toBeInTheDocument();
    const oldCol = screen.getByText('Already present before it (1)').parentElement!;
    expect(within(oldCol).getByText(/already overlaps something/)).toBeInTheDocument();
    expect(screen.getByText('Can be rescheduled')).toBeInTheDocument();
    expect(screen.getByText('Protected by you', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Deadline at risk')).toBeInTheDocument();
    expect(screen.getByText('Caused by the disruption')).toBeInTheDocument();
    expect(screen.getByText(/does not assign tasks to specific time slots/)).toBeInTheDocument();
  });

  it('shows a success state when there are no conflicts', async () => {
    handlers['/api/recovery/analyze'] = () => okResponse(emptyAnalysis(), 'analyze_conflicts');
    const user = await loaded();
    await fillAndAnalyze(user);
    expect(await screen.findByText('No conflicts')).toBeInTheDocument();
    expect(screen.getByText('The disruption introduces no new conflicts.')).toBeInTheDocument();
    expect(screen.getByText('The stored schedule has no existing conflicts in this window.')).toBeInTheDocument();
  });

  it('shows an analysis failure and offers to try again', async () => {
    let fail = true;
    handlers['/api/recovery/analyze'] = () => (fail ? errResponse('mcp_tool_error', 'Invalid request: event not found', 'analyze_conflicts') : okResponse(analysisWithConflict(), 'analyze_conflicts'));
    const user = await loaded();
    await fillAndAnalyze(user);
    const alert = await screen.findByText('The analysis could not be completed');
    expect(alert.closest('[role=alert]')).toHaveTextContent('Invalid request: event not found');
    expect(screen.queryByRole('button', { name: /Generate recovery plans/ })).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Caused by this disruption (1)')).toBeInTheDocument();
  });

  it('marks results as out of date when the scenario is edited after analysis', async () => {
    handlers['/api/recovery/analyze'] = () => okResponse(analysisWithConflict(), 'analyze_conflicts');
    const user = await loaded();
    await fillAndAnalyze(user);
    const generate = await screen.findByRole('button', { name: 'Generate recovery plans' });
    expect(generate).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '60 min' }));
    expect(generate).toBeDisabled();
    expect(screen.getByText(/scenario above changed/)).toBeInTheDocument();
  });
});

describe('recovery plans and validation', () => {
  const a = plan('plan-a', 1, 'minimal_disruption');
  const b = plan('plan-b', 2, 'buffered_transitions', {
    changes: [
      { eventId: 'evt-002', title: 'Lunch Break', originalStartTime: '2026-10-22T12:30:00+05:30', originalEndTime: '2026-10-22T13:15:00+05:30', proposedStartTime: '2026-10-22T13:20:00+05:30', proposedEndTime: '2026-10-22T14:05:00+05:30', reason: 'Buffered after the meeting.' },
      { eventId: 'evt-003', title: 'Project Review', originalStartTime: '2026-10-22T13:30:00+05:30', originalEndTime: '2026-10-22T14:30:00+05:30', proposedStartTime: '2026-10-22T14:10:00+05:30', proposedEndTime: '2026-10-22T15:10:00+05:30', reason: 'Pushed by lunch.' },
    ],
  });

  async function toPlans(set = planSet([a, b])): Promise<ReturnType<typeof userEvent.setup>> {
    handlers['/api/recovery/analyze'] = () => okResponse(analysisWithConflict(), 'analyze_conflicts');
    handlers['/api/recovery/propose'] = () => okResponse(set, 'propose_recovery_plan', `${set.candidates.length} candidates returned`);
    const user = await loaded();
    await fillAndAnalyze(user);
    await user.click(await screen.findByRole('button', { name: 'Generate recovery plans' }));
    await screen.findByText(/propose_recovery_plan · independently validated/);
    await waitFor(() => expect(screen.queryByText('Generating recovery plans…')).not.toBeInTheDocument());
    return user;
  }

  it('lists the engine’s candidates in its order with honest score wording', async () => {
    await toPlans();
    const group = screen.getByRole('group', { name: 'Candidate recovery plans' });
    const cards = within(group).getAllByRole('button');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('#1');
    expect(cards[0]).toHaveTextContent('Minimal disruption');
    expect(cards[0]).toHaveTextContent('Recommended');
    expect(cards[0]).toHaveTextContent('Penalty score 100 (lower is better)');
    expect(cards[0]).toHaveTextContent('1 event changed');
    expect(cards[1]).toHaveTextContent('2 events changed');
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true');
    expect(group.textContent).not.toMatch(/%|confidence|probability/i);
    expect(callsTo('/api/recovery/propose')[0]!.body).toMatchObject({ preferences: { optimizeFor: 'minimal_disruption' } });
  });

  it('lets the user select another candidate and shows only its changes, protected events and task capacity', async () => {
    const user = await toPlans();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Lunch Break')).toBeInTheDocument();
    expect(within(table).queryByText('Project Review')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Buffered transitions/ }));
    expect(screen.getByRole('button', { name: /Buffered transitions/ })).toHaveAttribute('aria-pressed', 'true');
    const table2 = screen.getByRole('table');
    expect(within(table2).getByText('Project Review')).toBeInTheDocument();
    expect(within(table2).getByText('50 min later')).toBeInTheDocument(); // 13:20 vs 12:30
    expect(within(table2).getByText('40 min later')).toBeInTheDocument(); // 14:10 vs 13:30
    expect(within(table2).getAllByText(/UTC\+05:30/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Protected events — unchanged \(1\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Doctor's Appointment").length).toBeGreaterThan(0);
    expect(screen.getByText(/aggregate task capacity/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Original schedule' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Proposed schedule' })).toBeInTheDocument();
  });

  it('never offers an apply action and states the calendar is unchanged', async () => {
    await toPlans();
    expect(screen.queryByRole('button', { name: /apply|approve|accept/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing here can be applied in this version/)).toBeInTheDocument();
  });

  it('explains an infeasible result without inventing candidates', async () => {
    await toPlans(
      planSet([], {
        outcome: 'infeasible',
        infeasibility: { summary: 'Lunch Break is protected but overlaps the extended meeting.', reasons: [{ code: 'fixed_conflict', eventIds: ['evt-001', 'evt-002'], message: 'Two events that cannot move overlap.' }] },
        summary: 'No plan satisfies every hard constraint.',
      }),
    );
    expect(screen.getByText('No feasible plan')).toBeInTheDocument();
    expect(screen.getByText('Why no plan satisfies every rule')).toBeInTheDocument();
    expect(screen.getByText('Two events that cannot move overlap.')).toBeInTheDocument();
    expect(screen.getByText('Events: Team Meeting, Lunch Break')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Candidate recovery plans' })).not.toBeInTheDocument();
  });

  it('says so when no candidates come back and no reason is given', async () => {
    await toPlans(planSet([], { summary: 'Nothing returned.' }));
    expect(screen.getByText('No candidates were returned')).toBeInTheDocument();
  });

  it('shows a proposal failure with a retry', async () => {
    handlers['/api/recovery/analyze'] = () => okResponse(analysisWithConflict(), 'analyze_conflicts');
    handlers['/api/recovery/propose'] = () => errResponse('mcp_timeout', 'The PlanRescue MCP server did not respond in time.', 'propose_recovery_plan');
    const user = await loaded();
    await fillAndAnalyze(user);
    await user.click(await screen.findByRole('button', { name: 'Generate recovery plans' }));
    expect(await screen.findByText('Recovery plans could not be generated')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('did not respond in time');
  });

  it('sends the candidate to validate_recovery_plan exactly as the engine returned it, and shows a valid result', async () => {
    handlers['/api/recovery/validate'] = () => okResponse(validation({ summary: 'Plan is valid: re-checked 1 change.' }), 'validate_recovery_plan', 'Plan is valid');
    const user = await toPlans();
    await user.click(screen.getByRole('button', { name: 'Verify this plan' }));
    expect(await screen.findByText('✓ Plan is valid')).toBeInTheDocument();
    expect(screen.getByText('Plan is valid: re-checked 1 change.')).toBeInTheDocument();
    expect(screen.getByText('No overlapping events', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Protected events unchanged', { exact: false })).toBeInTheDocument();
    expect(callsTo('/api/recovery/validate')[0]!.body).toEqual(JSON.parse(JSON.stringify(a)));
    // The roster now reflects the real validate call.
    expect(within(screen.getByRole('complementary')).getAllByText('Plan is valid').length).toBeGreaterThan(0);
  });

  it('shows the actual violations of an invalid plan', async () => {
    handlers['/api/recovery/validate'] = () =>
      okResponse(
        validation({ isValid: false, summary: 'Plan is invalid: 1 hard violation.', violations: [{ check: 'protected_events', eventId: 'evt-005', taskId: null, message: "Doctor's Appointment was moved but is protected." }], checks: [{ name: 'protected_events', passed: false, severity: 'hard', eventId: 'evt-005', taskId: null, message: 'x' }] }),
        'validate_recovery_plan',
        'Plan is invalid: 1 violation',
      );
    const user = await toPlans();
    await user.click(screen.getByRole('button', { name: 'Verify this plan' }));
    expect(await screen.findByText('✕ Plan is invalid')).toBeInTheDocument();
    expect(screen.getByText("Doctor's Appointment was moved but is protected.")).toBeInTheDocument();
    expect(screen.getByText('Hard constraint violations (1)')).toBeInTheDocument();
    expect(screen.getByText('Event: Doctor\'s Appointment')).toBeInTheDocument();
    expect(screen.queryByText('✓ Plan is valid')).not.toBeInTheDocument();
  });

  it('treats a validation transport failure as "could not check", never as valid or invalid', async () => {
    let fail = true;
    handlers['/api/recovery/validate'] = () => (fail ? errResponse('mcp_unavailable', 'The PlanRescue MCP server is not reachable.', 'validate_recovery_plan') : okResponse(validation(), 'validate_recovery_plan', 'Plan is valid'));
    const user = await toPlans();
    await user.click(screen.getByRole('button', { name: 'Verify this plan' }));
    const alert = await screen.findByText('Validation could not be completed');
    expect(alert.closest('[role=alert]')).toHaveTextContent('not a verdict on the plan');
    expect(screen.queryByText('✓ Plan is valid')).not.toBeInTheDocument();
    expect(screen.queryByText('✕ Plan is invalid')).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByText(/Failed:/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('✓ Plan is valid')).toBeInTheDocument();
  });

  it('shows a tool-level validation error differently from an invalid plan', async () => {
    handlers['/api/recovery/validate'] = () => errResponse('mcp_tool_error', 'Invalid request: timestamp has no UTC offset', 'validate_recovery_plan');
    const user = await toPlans();
    await user.click(screen.getByRole('button', { name: 'Verify this plan' }));
    expect(await screen.findByText('The validation tool reported an error')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('timestamp has no UTC offset');
  });

  it('keeps validation results per candidate while the user compares plans', async () => {
    handlers['/api/recovery/validate'] = () => okResponse(validation(), 'validate_recovery_plan', 'Plan is valid');
    const user = await toPlans();
    await user.click(screen.getByRole('button', { name: 'Verify this plan' }));
    await screen.findByText('✓ Plan is valid');
    await user.click(screen.getByRole('button', { name: /Buffered transitions/ }));
    expect(screen.queryByText('✓ Plan is valid')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Minimal disruption/ }));
    expect(screen.getByText('✓ Plan is valid')).toBeInTheDocument();
  });
});

describe('activity view', () => {
  it('lists every call made this session, newest first', async () => {
    handlers['/api/recovery/analyze'] = () => okResponse(analysisWithConflict(), 'analyze_conflicts', '1 new, 1 existing conflict');
    const user = await loaded();
    await fillAndAnalyze(user);
    await screen.findByText('Caused by this disruption (1)');
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    const log = screen.getByRole('list', { name: 'MCP calls, newest first' });
    const rows = within(log).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('analyze_conflicts');
  });
});
