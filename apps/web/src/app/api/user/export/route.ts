import { getAuthService } from '@/lib/auth/service';
import { failFrom, ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request);

    const exportData = authService.exportUserData(authContext.user.id);
    return ok(exportData);
  } catch (error) {
    return failFrom(error);
  }
}
