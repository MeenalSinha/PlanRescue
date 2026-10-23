import { callMcpTool } from '@/lib/mcpClient';
import { planSetSchema } from '@/lib/contract';
import { MAX_BODY_BYTES, proposeRequestSchema } from '@/lib/requests';
import { handleToolRoute } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

/** POST /api/recovery/propose -> MCP tool propose_recovery_plan (read-only proposal, nothing is saved). */
export async function POST(request: Request) {
  return handleToolRoute(request, {
    maxBytes: MAX_BODY_BYTES,
    schema: proposeRequestSchema,
    call: (input, _original, config) =>
      callMcpTool(
        'propose_recovery_plan',
        {
          startTime: input.startTime,
          endTime: input.endTime,
          disruption: input.disruption,
          ...(input.protectedEventIds && input.protectedEventIds.length > 0 ? { protectedEventIds: input.protectedEventIds } : {}),
          ...(input.preferences?.optimizeFor ? { preferences: { optimizeFor: input.preferences.optimizeFor } } : {}),
        },
        planSetSchema,
        (set) => (set.outcome === 'infeasible' ? 'No feasible plan' : set.outcome === 'no_changes_needed' ? 'No changes needed' : `${set.candidates.length} candidate${set.candidates.length === 1 ? '' : 's'} returned`),
        config,
      ),
  });
}
