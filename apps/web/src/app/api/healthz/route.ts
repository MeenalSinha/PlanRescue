import { getAuthDatabase } from '@/lib/auth/db';
import { failFrom, ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getAuthDatabase();
    const probe = db.prepare('SELECT 1 as live').get() as { live: number } | undefined;
    const dbHealthy = probe?.live === 1;

    const data = {
      status: dbHealthy ? 'healthy' : 'degraded',
      db: dbHealthy ? 'ready' : 'unreachable',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };

    return ok(data);
  } catch (error) {
    return failFrom(error);
  }
}
