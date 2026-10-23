import { callMcpTool } from '@/lib/mcpClient';
import { validationResultSchema } from '@/lib/contract';
import { MAX_PLAN_BODY_BYTES, validateRequestSchema } from '@/lib/requests';
import { handleToolRoute } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/recovery/validate -> MCP tool validate_recovery_plan.
 * The candidate is forwarded exactly as received (after validation), not rebuilt field by field.
 */
export async function POST(request: Request) {
  return handleToolRoute(request, {
    maxBytes: MAX_PLAN_BODY_BYTES,
    schema: validateRequestSchema,
    call: (_input, original, config) =>
      callMcpTool(
        'validate_recovery_plan',
        original as Record<string, unknown>,
        validationResultSchema,
        (v) => (v.isValid ? 'Plan is valid' : `Plan is invalid: ${v.violations.length} violation${v.violations.length === 1 ? '' : 's'}`),
        config,
      ),
  });
}
