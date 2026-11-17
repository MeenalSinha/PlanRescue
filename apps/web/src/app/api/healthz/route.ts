import { getAuthDatabase } from '@/lib/auth/db';
import { loadServerConfig } from '@/lib/env';
import { fail, failFrom, ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const probe = searchParams.get('probe') || 'readiness';

    const uptimeSeconds = Math.round(process.uptime());
    const timestamp = new Date().toISOString();

    // 1. Liveness Probe (quick check that process is responding)
    if (probe === 'liveness') {
      return ok({
        status: 'alive',
        uptimeSeconds,
        timestamp,
        version: '0.1.0',
      });
    }

    // 2. Readiness Probe (verifies database connectivity and WAL readiness)
    let dbStatus = 'unreachable';
    let walStatus = 'unknown';

    try {
      const db = getAuthDatabase();
      const ping = db.prepare('SELECT 1 as live').get() as { live: number } | undefined;
      if (ping?.live === 1) {
        dbStatus = 'ready';
      }

      const journalMode = db.pragma('journal_mode', { simple: true });
      walStatus = typeof journalMode === 'string' ? journalMode.toLowerCase() : 'unknown';
    } catch {
      dbStatus = 'unreachable';
    }

    let mcpConfigStatus = 'ok';
    try {
      loadServerConfig();
    } catch {
      mcpConfigStatus = 'misconfigured';
    }

    const isReady = dbStatus === 'ready';

    const data = {
      status: isReady ? 'ready' : 'unready',
      checks: {
        database: dbStatus,
        walMode: walStatus,
        mcpConfig: mcpConfigStatus,
      },
      uptimeSeconds,
      timestamp,
      version: '0.1.0',
    };

    if (!isReady) {
      return fail('mcp_unavailable', 'Readiness check failed: database unreachable', [], data as any);
    }

    return ok(data);
  } catch (error) {
    return failFrom(error);
  }
}
