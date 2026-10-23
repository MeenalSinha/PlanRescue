import { callMcpTool } from '@/lib/mcpClient';
import { getActionHistoryOutputSchema } from '@/lib/contract';
import { ok, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const recoveryPlanId = searchParams.get('recoveryPlanId') ?? undefined;
    const actionType = searchParams.get('actionType') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

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

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
