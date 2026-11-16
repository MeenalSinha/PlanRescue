import { callMcpTool } from '@/lib/mcpClient';
import { getRecoveryPlansOutputSchema } from '@/lib/contract';
import { ok, fail, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';
import { getAuthService } from '@/lib/auth/service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request);

    if (!authService.verifyPlanOwnership(planId, authContext.user.id)) {
      return fail('forbidden', 'You do not have permission to access this recovery plan');
    }

    const config = loadServerConfig();

    const res = await callMcpTool(
      'get_recovery_plans',
      { planId },
      getRecoveryPlansOutputSchema,
      (out) => `Retrieved recovery plan ${planId}`,
      config,
    );

    if (res.data.plans.length === 0) {
      return fail('invalid_request', `Recovery plan ${planId} not found.`, [res.activity]);
    }

    return ok(res.data.plans[0], [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
