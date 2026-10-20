/**
 * Demo MCP client: connects to a running PlanRescue server over Streamable HTTP, discovers
 * its tools and calls get_schedule through the real protocol. Useful for a live demo and
 * for a quick manual check that `npm run dev:mcp` (or start:mcp) is serving correctly.
 *
 *   npm run dev:mcp          # terminal 1
 *   npm run demo:client      # terminal 2
 *
 * Override the target with MCP_URL, for example MCP_URL=http://127.0.0.1:3001/mcp
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = process.env.MCP_URL ?? 'http://127.0.0.1:3001/mcp';

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
    .join('\n');
}

async function main(): Promise<void> {
  // 'auto' probes for the newest protocol revision and falls back to the 2025 handshake.
  const client = new Client({ name: 'planrescue-demo-client', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));

  try {
    const server = client.getServerVersion();
    console.log(`Connected to ${server?.name} v${server?.version} at ${url}`);
    console.log(`Protocol era: ${client.getProtocolEra()} | negotiated version: ${client.getNegotiatedProtocolVersion()}`);

    const { tools } = await client.listTools();
    console.log(`\nTools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

    console.log('\nScenario: "Show me my afternoon" (12:00 to 18:00 IST on 2026-10-22)');
    const afternoon = await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T12:00:00+05:30', endTime: '2026-10-22T18:00:00+05:30' },
    });
    console.log(textOf(afternoon as never));

    console.log('\nSame interval expressed in UTC (06:30Z to 12:30Z) returns the same events:');
    const utc = await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T06:30:00Z', endTime: '2026-10-22T12:30:00Z' },
    });
    console.log(textOf(utc as never).split('\n')[0]);

    console.log('\nInvalid request (end before start):');
    const invalid = await client.callTool({
      name: 'get_schedule',
      arguments: { startTime: '2026-10-22T18:00:00+05:30', endTime: '2026-10-22T12:00:00+05:30' },
    });
    console.log(`isError=${invalid.isError} | ${textOf(invalid as never)}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Is the server running? Start it with: npm run dev:mcp');
  process.exit(1);
});
