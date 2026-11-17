import { callMcpTool } from '@/lib/mcpClient';
import { getActionHistoryOutputSchema } from '@/lib/contract';
import { ok, fail, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';
import { getAuthService } from '@/lib/auth/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request);

    const { searchParams } = new URL(request.url);
    const recoveryPlanId = searchParams.get('recoveryPlanId') ?? undefined;
    const actionType = searchParams.get('actionType') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

    if (recoveryPlanId && !authContext.isDefault) {
      if (!authService.verifyPlanOwnership(recoveryPlanId, authContext.user.id)) {
        return fail('forbidden', 'You do not have permission to view history for this recovery plan');
      }
    }

    const config = loadServerConfig();

    const res = await callMcpTool(
      'get_action_history',
      {
        ...(recoveryPlanId ? { recoveryPlanId } : {}),
        ...(actionType ? { actionType } : {}),
        ...(limit ? { limit } : {}),
      },
      getActionHistoryOutputSchema,
      (out) => `Retrieved ${out.count} action history entries`,
      config,
    );

    // If authenticated non-default user and no single plan specified, filter entries by user's owned plans or user actor
    if (!authContext.isDefault && Array.isArray(res.data.actions)) {
      const userPlanIds = new Set(authService.getUserPlanIds(authContext.user.id));
      const filtered = (res.data.actions as Array<{ recoveryPlanId?: string; actor?: string }>).filter((a) => {
        if (a.recoveryPlanId && userPlanIds.has(a.recoveryPlanId)) return true;
        if (a.actor === authContext.user.displayName || a.actor === authContext.user.id) return true;
        return false;
      });
      (res.data as any).actions = filtered;
      (res.data as any).count = filtered.length;
    }

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
