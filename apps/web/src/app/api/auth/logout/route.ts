import { getAuthService } from '@/lib/auth/service';
import { ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let token: string | null = null;
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.substring(7).trim();
  }
  if (!token) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/planrescue_session=([^;]+)/);
      if (match && match[1]) {
        token = match[1].trim();
      }
    }
  }

  if (token) {
    const authService = getAuthService();
    authService.logout(token);
  }

  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    'planrescue_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  );

  return new Response(JSON.stringify({ status: 'ok', data: { success: true } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(headers.entries()),
    },
  });
}
