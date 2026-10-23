import { callMcpTool } from '@/lib/mcpClient';
import { approveRecoveryPlanOutputSchema } from '@/lib/contract';
import { ok, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const config = loadServerConfig();

    const res = await callMcpTool(
      'approve_recovery_plan',
      { planId },
      approveRecoveryPlanOutputSchema,
      (out) => `Approved recovery plan ${out.planId}`,
      config,
    );

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
