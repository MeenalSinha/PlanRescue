import { callMcpTool } from '@/lib/mcpClient';
import { getRecoveryPlansOutputSchema } from '@/lib/contract';
import { ok, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get('planId') ?? undefined;
    const requestId = searchParams.get('requestId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

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

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
