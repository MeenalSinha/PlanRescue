import { getAuthService } from '@/lib/auth/service';
import { scheduleOutputSchema, tasksOutputSchema } from '@/lib/contract';
import { loadServerConfig } from '@/lib/env';
import { analyzeProductivity } from '@/lib/intelligence/productivityEngine';
import { callMcpTool } from '@/lib/mcpClient';
import { fail, failFrom, ok } from '@/lib/routeKit';
import { dayWindow, isValidDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const authService = getAuthService();
    const authContext = authService.authenticateRequest(request, { required: false });
    const prefs = authService.getPreferences(authContext.user.id);

    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date');
    const targetDate = dateParam && isValidDate(dateParam) ? dateParam : '2026-10-22';

    const config = loadServerConfig();
    const window = dayWindow(targetDate, prefs.timezone);

    const scheduleRes = await callMcpTool(
      'get_schedule',
      { startTime: window.startTime, endTime: window.endTime },
      scheduleOutputSchema,
      (out) => `${out.count} events`,
      config,
    );

    const tasksRes = await callMcpTool(
      'get_tasks',
      {},
      tasksOutputSchema,
      (out) => `${out.count} tasks`,
      config,
    );

    const insights = analyzeProductivity(
      targetDate,
      scheduleRes.data.events,
      tasksRes.data.tasks,
      {
        workingHoursStart: prefs.workingHoursStart,
        workingHoursEnd: prefs.workingHoursEnd,
        preferredBufferMinutes: prefs.preferredBufferMinutes,
      },
    );

    return ok(insights, [scheduleRes.activity, tasksRes.activity]);
  } catch (error) {
    return failFrom(error);
  }
}
