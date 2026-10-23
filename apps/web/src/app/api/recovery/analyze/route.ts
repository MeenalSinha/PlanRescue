import { callMcpTool } from '@/lib/mcpClient';
import { conflictAnalysisSchema } from '@/lib/contract';
import { MAX_BODY_BYTES, analyzeRequestSchema } from '@/lib/requests';
import { handleToolRoute } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

/** POST /api/recovery/analyze -> MCP tool analyze_conflicts (read-only, hypothetical disruption). */
export async function POST(request: Request) {
  return handleToolRoute(request, {
    maxBytes: MAX_BODY_BYTES,
    schema: analyzeRequestSchema,
    call: (input, _original, config) =>
      callMcpTool(
        'analyze_conflicts',
        {
          startTime: input.startTime,
          endTime: input.endTime,
          disruption: input.disruption,
          ...(input.protectedEventIds && input.protectedEventIds.length > 0 ? { protectedEventIds: input.protectedEventIds } : {}),
        },
        conflictAnalysisSchema,
        (a) => `${a.newConflicts.length} new, ${a.existingConflicts.length} existing conflict${a.existingConflicts.length === 1 ? '' : 's'}`,
        config,
      ),
  });
}
