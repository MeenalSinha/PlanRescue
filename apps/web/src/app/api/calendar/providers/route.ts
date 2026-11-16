import { getAuthService } from '@/lib/auth/service';
import { getCalendarSyncManager } from '@/lib/calendar/syncManager';
import { ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);
  const syncManager = getCalendarSyncManager();

  const connectedAccounts = syncManager.listAccounts(authContext.user.id);
  const connectedMap = new Map(connectedAccounts.map((a) => [a.provider, a]));

  const providers = [
    {
      id: 'google',
      name: 'Google Calendar',
      description: 'Synchronize events and execute approved schedule adjustments directly on Google Calendar.',
      isConnected: connectedMap.has('google'),
      account: connectedMap.get('google') || null,
      authUrl: '/api/calendar/connect?provider=google',
    },
    {
      id: 'outlook',
      name: 'Microsoft Outlook (Graph)',
      description: 'Synchronize events and execute approved adjustments via Microsoft 365 Graph Calendar API.',
      isConnected: connectedMap.has('outlook'),
      account: connectedMap.get('outlook') || null,
      authUrl: '/api/calendar/connect?provider=outlook',
    },
    {
      id: 'local',
      name: 'PlanRescue Studio Local SQLite',
      description: 'Built-in local SQLite ACID calendar storage for low-latency offline productivity studio interaction.',
      isConnected: true,
      account: {
        id: 'cal_local',
        userId: authContext.user.id,
        provider: 'local',
        accountEmail: authContext.user.email,
        syncStatus: 'connected',
        createdAt: authContext.user.createdAt,
        updatedAt: authContext.user.updatedAt,
      },
      authUrl: null,
    },
  ];

  return ok({ providers });
}
