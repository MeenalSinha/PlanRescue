import { getAuthService } from '@/lib/auth/service';
import { ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authService = getAuthService();
  const authContext = authService.authenticateRequest(request);

  return ok({
    user: authContext.user,
    preferences: authContext.preferences,
    isAuthenticated: !authContext.isDefault,
  });
}
