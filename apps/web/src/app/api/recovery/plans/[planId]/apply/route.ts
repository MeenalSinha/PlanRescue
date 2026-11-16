import { callMcpTool } from '@/lib/mcpClient';
import { applyApprovedPlanOutputSchema } from '@/lib/contract';
import { ok, fail, failFrom } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';
import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';

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
      return fail('forbidden', 'You do not have permission to execute this recovery plan');
    }

    const config = loadServerConfig();

    const res = await callMcpTool(
      'apply_approved_plan',
      { planId, actor: authContext.user.displayName },
      applyApprovedPlanOutputSchema,
      (out) => `Applied recovery plan ${out.planId} (${out.changesCount} events updated)`,
      config,
    );

    // Phase 10: If user has connected external calendars, queue outbox reconciliation
    if (res.data.status === 'applied' && res.data.changes.length > 0) {
      try {
        const syncManager = getCalendarSyncManager();
        const accounts = syncManager.listAccounts(authContext.user.id);
        for (const acc of accounts) {
          if (acc.provider === 'google' || acc.provider === 'outlook') {
            for (const c of res.data.changes) {
              syncManager.queueOutboxChange(authContext.user.id, planId, acc.provider, {
                eventId: c.eventId,
                originalStartTime: c.previousStartTime,
                originalEndTime: c.previousEndTime,
                proposedStartTime: c.newStartTime,
                proposedEndTime: c.newEndTime,
              });
            }
            // Trigger reconciliation asynchronously
            syncManager.reconcileOutbox(authContext.user.id, acc.provider).catch(() => {});
          }
        }
      } catch {
        // Outbox queueing should not fail the primary local atomic transaction response
      }
    }

    return ok(res.data, [res.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
