/**
 * End-to-end: the real React app (rendered in jsdom) talks over real HTTP to the real production Next.js
 * server, which talks through the official MCP client and Streamable HTTP to the real MCP server, the
 * Recovery Engine and SQLite. Nothing is mocked; only the browser itself is simulated.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '@/components/App';
import { startStack, type Stack } from './helpers/stack';

const realFetch = globalThis.fetch.bind(globalThis);
let stack: Stack;
let fingerprintBefore: string;

beforeAll(async () => {
  stack = await startStack();
  fingerprintBefore = stack.databaseFingerprint();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => realFetch(new URL(String(input), stack.webUrl), init));
});
afterEach(cleanup);
afterAll(async () => {
  vi.unstubAllGlobals();
  await stack?.stop();
});

describe('PlanRescue end to end through the real MCP server', () => {
  it('view schedule → 40-minute delay → analyze → compare plans → validate, with the database untouched', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Dashboard comes from get_schedule + get_tasks.
    const tasks = await screen.findByRole('list', { name: 'Tasks and deadlines' }, { timeout: 15_000 });
    expect(within(tasks).getByText('Complete project report')).toBeInTheDocument();
    expect(within(tasks).getByText('Prepare for project review')).toBeInTheDocument();
    const schedule = screen.getByRole('list', { name: 'Schedule for the day' });
    for (const title of ['Team Meeting', 'Lunch Break', 'Project Review', 'Focus Work', "Doctor's Appointment", 'Project Deadline Work']) {
      expect(within(schedule).getByText(title)).toBeInTheDocument();
    }
    expect(screen.getAllByText('MCP server connected').length).toBeGreaterThan(0);
    const select = screen.getByLabelText('Event that ran late');
    expect(within(select).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['', 'evt-001', 'evt-002', 'evt-003', 'evt-004', 'evt-005', 'evt-006']);

    // 2. Report the disruption: Team Meeting runs 40 minutes late; the doctor's appointment is protected.
    await user.selectOptions(select, 'evt-001');
    await user.click(screen.getByRole('button', { name: '40 min' }));
    await user.click(screen.getByRole('checkbox', { name: /Doctor's Appointment/ }));
    await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));

    // 3. analyze_conflicts: the overrun collides with lunch; nothing pre-existing.
    await screen.findByText('Caused by this disruption (1)', undefined, { timeout: 15_000 });
    expect(screen.getByText(/overlaps Lunch Break/)).toBeInTheDocument();
    expect(screen.getByText('Already present before it (0)')).toBeInTheDocument();
    expect(screen.getByText('Conflicts that can be resolved')).toBeInTheDocument();

    // 4. propose_recovery_plan: the engine's real candidates.
    await user.click(screen.getByRole('button', { name: 'Generate recovery plans' }));
    const group = await screen.findByRole('group', { name: 'Candidate recovery plans' }, { timeout: 15_000 });
    const cards = within(group).getAllByRole('button');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]).toHaveTextContent('#1');
    expect(cards[0]).toHaveTextContent('(lower is better)');
    expect(cards[0]).toHaveTextContent('Passed validation when generated');
    expect(screen.getByText(/Recovery plan proposed — calendar unchanged/)).toBeInTheDocument();

    // Comparison details come straight from the returned candidate.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Lunch Break')).toBeInTheDocument();
    expect(within(table).getAllByText(/later/).length).toBeGreaterThan(0);
    const protectedSection = screen.getByRole('heading', { name: /Protected events — unchanged/ }).closest('section')!;
    expect(within(protectedSection).getByText("Doctor's Appointment")).toBeInTheDocument();
    expect(within(protectedSection).getAllByText('Unchanged in this plan').length).toBeGreaterThan(0);

    // 5. Select the top candidate explicitly and verify it independently.
    await user.click(cards[0]!);
    await user.click(screen.getByRole('button', { name: 'Verify this plan' }));
    expect(await screen.findByText('✓ Plan is valid', undefined, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByText(/Re-checked \d+ proposed change/)).toBeInTheDocument();
    expect(screen.getByText('Validation checks a plan. It does not apply it: the stored calendar is unchanged.')).toBeInTheDocument();

    // 6. The activity panel reflects real calls to all five tools.
    const roster = screen.getByRole('complementary');
    await waitFor(() => expect(within(roster).queryAllByText('Not called yet')).toHaveLength(0));
    for (const tool of ['get_schedule', 'get_tasks', 'analyze_conflicts', 'propose_recovery_plan', 'validate_recovery_plan']) {
      expect(within(roster).getAllByText(tool).length).toBeGreaterThan(0);
    }

    // 7. The MCP server itself saw every call, and nothing changed in SQLite.
    const logs = stack.mcp.logs();
    for (const tool of ['get_schedule', 'get_tasks', 'analyze_conflicts', 'propose_recovery_plan', 'validate_recovery_plan']) {
      expect(logs, tool).toMatch(new RegExp(`Tool: ${tool}`));
    }
    expect(stack.databaseFingerprint()).toBe(fingerprintBefore);
  });

  it('shows the real "no feasible plan" explanation when every movable event is protected', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('list', { name: 'Tasks and deadlines' }, { timeout: 15_000 });
    await user.selectOptions(screen.getByLabelText('Event that ran late'), 'evt-001');
    await user.click(screen.getByRole('checkbox', { name: /Lunch Break/ }));
    await user.click(screen.getByRole('button', { name: 'Analyze disruption' }));
    await screen.findByText(/Caused by this disruption/, undefined, { timeout: 15_000 });
    await user.click(screen.getByRole('button', { name: 'Generate recovery plans' }));
    expect(await screen.findByText('Why no plan satisfies every rule', undefined, { timeout: 15_000 })).toBeInTheDocument();
    const plans = document.getElementById('plans')!;
    expect(within(plans).getByText('No feasible plan')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Candidate recovery plans' })).not.toBeInTheDocument();
    expect(stack.databaseFingerprint()).toBe(fingerprintBefore);
  });
});
