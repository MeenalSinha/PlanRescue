import type { DashboardData, ToolActivity } from '@/lib/api';
import { conflictAnalysisSchema, scheduleOutputSchema, tasksOutputSchema } from '@/lib/contract';
import { DEFAULT_DATE, DEFAULT_PLANNING_END, DEFAULT_PLANNING_START, TASK_LOOKAHEAD_DAYS } from '@/lib/constants';
import { loadServerConfig } from '@/lib/env';
import { McpCallError, callMcpTool } from '@/lib/mcpClient';
import { dashboardQuerySchema, fieldErrors } from '@/lib/requests';
import { fail, failFrom, ok } from '@/lib/routeKit';
import { addDays, dayWindow, isValidDate, offsetForZone, withOffset } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard?date=YYYY-MM-DD
 * Calls get_schedule and get_tasks (and a baseline analyze_conflicts of the stored schedule) through MCP.
 */
export async function GET(request: Request) {
  const query = dashboardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return fail('invalid_request', 'The date is not valid.', [], fieldErrors(query.error));
  const date = query.data.date ?? DEFAULT_DATE;
  if (!isValidDate(date)) return fail('invalid_request', 'The date is not a real calendar date.', [], { date: 'Choose a real calendar date' });

  const activity: ToolActivity[] = [];
  try {
    const config = loadServerConfig();
    const window = dayWindow(date, config.calendarTimeZone);
    const taskWindow = { startTime: window.startTime, endTime: dayWindow(addDays(date, TASK_LOOKAHEAD_DAYS), config.calendarTimeZone).startTime };

    const [schedule, tasks] = await Promise.allSettled([
      callMcpTool('get_schedule', window, scheduleOutputSchema, (s) => `${s.count} event${s.count === 1 ? '' : 's'}`, config),
      callMcpTool('get_tasks', { startDeadline: taskWindow.startTime, endDeadline: taskWindow.endTime }, tasksOutputSchema, (t) => `${t.count} task${t.count === 1 ? '' : 's'}`, config),
    ]);
    for (const r of [schedule, tasks]) {
      if (r.status === 'fulfilled') activity.push(r.value.activity);
      else if (r.reason instanceof McpCallError) activity.push(r.reason.activity);
    }
    if (schedule.status === 'rejected' || tasks.status === 'rejected') {
      const reason = schedule.status === 'rejected' ? schedule.reason : (tasks as PromiseRejectedResult).reason;
      return reason instanceof McpCallError ? fail(reason.code, reason.message, activity) : failFrom(reason, activity);
    }

    // Baseline analysis of the stored schedule across the default working window. Optional: a failure
    // here is reported but does not stop the dashboard.
    const offset = offsetForZone(date, config.calendarTimeZone);
    const baselineWindow = { startTime: withOffset(`${date}T${DEFAULT_PLANNING_START}`, offset), endTime: withOffset(`${date}T${DEFAULT_PLANNING_END}`, offset) };
    let baseline: DashboardData['baseline'] = null;
    let baselineError: string | null = null;
    try {
      const r = await callMcpTool('analyze_conflicts', baselineWindow, conflictAnalysisSchema, (a) => `${a.existingConflicts.length} existing conflict${a.existingConflicts.length === 1 ? '' : 's'} (baseline)`, config);
      activity.push(r.activity);
      baseline = { window: baselineWindow, analysis: r.data };
    } catch (error) {
      if (error instanceof McpCallError) {
        activity.push(error.activity);
        baselineError = error.message;
      } else throw error;
    }

    const data: DashboardData = {
      date,
      calendarTimeZone: schedule.value.data.calendarTimeZone,
      taskTimeZone: tasks.value.data.taskTimeZone,
      utcOffset: offset,
      window,
      taskWindow,
      events: schedule.value.data.events,
      tasks: tasks.value.data.tasks,
      baseline,
      baselineError,
    };
    return ok(data, activity);
  } catch (error) {
    return failFrom(error, activity);
  }
}
