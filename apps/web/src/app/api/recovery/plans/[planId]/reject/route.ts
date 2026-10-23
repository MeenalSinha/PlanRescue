import { callMcpTool } from '@/lib/mcpClient';
import { rejectRecoveryPlanOutputSchema } from '@/lib/contract';
import { ok, failFrom, readJson } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    let reason: string | undefined;

    try {
      const body = await readJson(request, 10_000);
      if ('value' in body && typeof body.value === 'object' && body.value !== null) {
        reason = (body.value as { reason?: string }).reason;
      }
    } catch {
      // Body is optional for reject
    }

    const config = loadServerConfig();

    const res = await callMcpTool(
      'reject_recovery_plan',
      { planId, ...(reason ? { reason } : {}) },
      rejectRecoveryPlanOutputSchema,
      (out) => `Rejected recovery plan ${out.planId}`,
      config,
    );

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
