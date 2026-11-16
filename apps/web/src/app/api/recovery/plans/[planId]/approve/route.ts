import { callMcpTool } from '@/lib/mcpClient';
import { approveRecoveryPlanOutputSchema } from '@/lib/contract';
import { ok, fail, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';
import { getAuthService } from '@/lib/auth/service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request);

    if (!authService.verifyPlanOwnership(planId, authContext.user.id)) {
      return fail('forbidden', 'You do not have permission to approve this recovery plan');
    }

    const config = loadServerConfig();

    const res = await callMcpTool(
      'approve_recovery_plan',
      { planId, actor: authContext.user.displayName },
      approveRecoveryPlanOutputSchema,
      (out) => `Approved recovery plan ${out.planId}`,
      config,
    );

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
