import { getAuthService } from '@/lib/auth/service';
import { fail, failFrom, ok } from '@/lib/routeKit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request);

    // Prevent deleting the default studio dev user
    if (authContext.isDefault) {
      return fail('invalid_request', 'The default development studio account cannot be deleted.');
    }

    const success = authService.deleteUserAccount(authContext.user.id);
    return ok({
      deleted: success,
      message: 'All user data and associated records have been permanently deleted.',
    });
  } catch (error) {
    return failFrom(error);
  }
}
