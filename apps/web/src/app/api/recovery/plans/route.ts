import { callMcpTool } from '@/lib/mcpClient';
import { getRecoveryPlansOutputSchema } from '@/lib/contract';
import { ok, fail, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';
import { getAuthService } from '@/lib/auth/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request);

    const { searchParams } = new URL(request.url);
    const planId = searchParams.get('planId') ?? undefined;
    const requestId = searchParams.get('requestId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

    if (planId && !authContext.isDefault) {
      if (!authService.verifyPlanOwnership(planId, authContext.user.id)) {
        return fail('forbidden', 'You do not have permission to access this recovery plan');
      }
    }

    const config = loadServerConfig();

    const res = await callMcpTool(
      'get_recovery_plans',
      {
        ...(planId ? { planId } : {}),
        ...(requestId ? { requestId } : {}),
        ...(status ? { status } : {}),
        ...(limit ? { limit } : {}),
      },
      getRecoveryPlansOutputSchema,
      (out) => `Found ${out.count} recovery plan(s)`,
      config,
    );

    // If an authenticated non-default user requested plans, filter to plans owned by this user
    if (!authContext.isDefault) {
      const userPlanIds = new Set(authService.getUserPlanIds(authContext.user.id));
      res.data.plans = res.data.plans.filter((p: any) => userPlanIds.has(p.planId));
      res.data.count = res.data.plans.length;
    }

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
