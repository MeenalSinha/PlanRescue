/**
 * Demo MCP client: connects to a running PlanRescue server over Streamable HTTP, discovers
 * its tools, then reads the same workday through both of them: get_schedule (calendar events)
 * and get_tasks (work with deadlines). It only speaks MCP; it never touches the database or
 * the repository code.
 *
 *   npm run dev:mcp          # terminal 1 (creates and seeds ./data/planrescue.sqlite on first run)
 *   npm run demo:client      # terminal 2
 *
 * Override the target with MCP_URL, for example MCP_URL=http://127.0.0.1:3001/mcp
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = process.env.MCP_URL ?? 'http://127.0.0.1:3001/mcp';

/** The workday the seeded data describes: 22 October 2026 in Asia/Kolkata. */
const DAY_START = '2026-10-22T00:00:00+05:30';
const DAY_END = '2026-10-23T00:00:00+05:30';

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}
interface EventsOutput {
  count: number;
  events: Array<{ durationMinutes: number }>;
}
interface TasksOutput {
  count: number;
  tasks: Array<{ title: string; deadline: string; estimatedDurationMinutes: number; status: string }>;
}

function textOf(result: ToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`)).join('\n');
}

async function main(): Promise<void> {
  // 'auto' probes for the newest protocol revision and falls back to the 2025 handshake.
  const client = new Client({ name: 'planrescue-demo-client', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));

  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolResult;

  try {
    const server = client.getServerVersion();
    console.log(`Connected to ${server?.name} v${server?.version} at ${url}`);
    console.log(`Protocol era: ${client.getProtocolEra()} | negotiated version: ${client.getNegotiatedProtocolVersion()}`);

    const { tools } = await client.listTools();
    console.log(`\nTools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
    for (const tool of tools) console.log(`  - ${tool.name}: ${tool.description?.split('. ')[0]}.`);

    console.log('\n=== get_schedule: calendar events for 22 Oct 2026 (what is booked, and when) ===');
    const day = await call('get_schedule', { startTime: DAY_START, endTime: DAY_END });
    console.log(textOf(day));

    console.log('\n=== get_tasks: tasks due 22 Oct 2026 (work with deadlines, not fixed slots) ===');
    const dueToday = await call('get_tasks', { startDeadline: DAY_START, endDeadline: DAY_END });
    console.log(textOf(dueToday));

    console.log('\n=== get_tasks: only the tasks still open (status = pending) ===');
    const pending = await call('get_tasks', { status: 'pending' });
    console.log(textOf(pending));

    // Complementary view, computed only from the structured results the two tools returned.
    const events = day.structuredContent as EventsOutput | undefined;
    const tasks = dueToday.structuredContent as TasksOutput | undefined;
    if (events && tasks) {
      const bookedMinutes = events.events.reduce((sum, e) => sum + e.durationMinutes, 0);
      const open = tasks.tasks.filter((t) => t.status !== 'completed');
      const openMinutes = open.reduce((sum, t) => sum + t.estimatedDurationMinutes, 0);
      const latest = open.map((t) => t.deadline).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
      console.log('\n=== The day at a glance ===');
      console.log(`Calendar: ${events.count} events booking ${bookedMinutes} min.`);
      console.log(`Tasks:    ${open.length} still open needing ~${openMinutes} min of work; last deadline ${latest ?? 'none'}.`);
        console.log('The Recovery Engine below fits the open work around the booked events.');
    }

    // ---- Phase 3: the Recovery Engine, still only through MCP --------------------------------
    // "My meeting is running 40 minutes late. Fix my afternoon, but don't move my doctor's
    // appointment or miss my project deadline." as a structured event_overrun disruption.
    const interval = { startTime: '2026-10-22T08:00:00+05:30', endTime: '2026-10-22T20:00:00+05:30' };
    const disruption = { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 };

    console.log('\n=== analyze_conflicts: what does a 40-minute Team Meeting overrun break? (hypothetical; nothing is saved) ===');
    console.log(textOf(await call('analyze_conflicts', { ...interval, disruption })));

    console.log('\n=== propose_recovery_plan: deterministic, independently validated alternatives ===');
    const proposal = await call('propose_recovery_plan', { ...interval, disruption });
    console.log(textOf(proposal));

    const candidates = (proposal.structuredContent as { candidates?: unknown[] } | undefined)?.candidates ?? [];
    if (candidates.length > 0) {
      console.log('\n=== validate_recovery_plan: re-verify the top candidate, exactly as returned ===');
      console.log(textOf(await call('validate_recovery_plan', candidates[0] as Record<string, unknown>)));

      console.log('\n=== validate_recovery_plan: the same plan with the doctor\'s appointment moved (must be rejected) ===');
      const tampered = structuredClone(candidates[0]) as { changes: Array<Record<string, string>>; validation?: { isValid: boolean } };
      tampered.changes.push({ eventId: 'evt-005', proposedStartTime: '2026-10-22T17:00:00+05:30', proposedEndTime: '2026-10-22T18:00:00+05:30' });
      tampered.validation = { isValid: true }; // a false claim the validator does not trust
      console.log(textOf(await call('validate_recovery_plan', tampered as unknown as Record<string, unknown>)));

      // ---- Phase 6 & 7: Lifecycle, Approval, Safe Application & Action History ----
      console.log('\n=== save_recovery_plans: persist candidates with persistent IDs ===');
      const saveRes = await call('save_recovery_plans', {
        requestId: 'demo-req-001',
        plans: [candidates[0]],
      });
      console.log(textOf(saveRes));
      const savedPlans = (saveRes.structuredContent as { plans: Array<{ id: string }> })?.plans ?? [];
      const planId = savedPlans[0]?.id;

      if (planId) {
        console.log(`\n=== approve_recovery_plan: user explicitly approves plan ${planId} (calendar unchanged) ===`);
        const approveRes = await call('approve_recovery_plan', { planId, actor: 'demo-user' });
        console.log(textOf(approveRes));

        console.log('\n=== apply_approved_plan: atomically commit approved plan to SQLite ===');
        const applyRes = await call('apply_approved_plan', { planId, actor: 'demo-user' });
        console.log(textOf(applyRes));

        console.log('\n=== get_action_history: permanent audit trail of operations ===');
        const historyRes = await call('get_action_history', { recoveryPlanId: planId });
        console.log(textOf(historyRes));
      }
    }

    console.log('\nSame afternoon interval expressed in UTC (06:30Z to 12:30Z) returns the same events:');
    const utc = await call('get_schedule', { startTime: '2026-10-22T06:30:00Z', endTime: '2026-10-22T12:30:00Z' });
    console.log(textOf(utc).split('\n')[0]);

    console.log('\nInvalid requests are rejected with clear errors:');
    const badRange = await call('get_schedule', { startTime: '2026-10-22T18:00:00+05:30', endTime: '2026-10-22T12:00:00+05:30' });
    console.log(`get_schedule: isError=${badRange.isError} | ${textOf(badRange)}`);
    const badStatus = await call('get_tasks', { status: 'finished' });
    console.log(`get_tasks:    isError=${badStatus.isError} | ${textOf(badStatus)}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Is the server running? Start it with: npm run dev:mcp');
  process.exit(1);
});
