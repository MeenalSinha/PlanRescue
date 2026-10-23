/** Hand-built tool results for the isolated component tests. The real thing is covered by the integration tests. */
import type { ApiResponse, DashboardData, ToolActivity, ToolName } from '@/lib/api';
import type { ConflictAnalysis, RecoveryPlan, RecoveryPlanSet, ScheduleEvent, Task, ValidationResult } from '@/lib/contract';

const at = (hhmm: string, day = '2026-10-22'): string => `${day}T${hhmm}:00+05:30`;

export function ev(id: string, title: string, start: string, end: string, over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return { id, title, startTime: at(start), endTime: at(end), priority: 'medium', movable: true, category: 'meeting', durationMinutes: eh * 60 + em - sh * 60 - sm, ...over };
}

export const EVENTS: ScheduleEvent[] = [
  ev('evt-001', 'Team Meeting', '11:30', '12:30', { priority: 'high', movable: false }),
  ev('evt-002', 'Lunch Break', '12:30', '13:15', { priority: 'low', category: 'personal' }),
  ev('evt-003', 'Project Review', '13:30', '14:30', { priority: 'high' }),
  ev('evt-005', "Doctor's Appointment", '16:30', '17:30', { priority: 'critical', movable: false, category: 'medical' }),
];

export const TASKS: Task[] = [
  { id: 'task-002', title: 'Prepare for project review', estimatedDurationMinutes: 30, deadline: at('13:30'), priority: 'high', status: 'pending' },
  { id: 'task-001', title: 'Complete project report', estimatedDurationMinutes: 120, deadline: at('20:00'), priority: 'critical', status: 'in_progress' },
];

export function activity(tool: ToolName, summary = 'ok', status: 'success' | 'error' = 'success', errorCode?: ToolActivity['errorCode']): ToolActivity {
  return { id: `${tool}-${Math.random().toString(36).slice(2)}`, tool, status, startedAt: '2026-10-22T07:00:00.000Z', durationMs: 12, summary, ...(errorCode ? { errorCode } : {}) };
}

export const emptyAnalysis = (over: Partial<ConflictAnalysis> = {}): ConflictAnalysis => ({
  interval: { startTime: at('08:00'), endTime: at('20:00') },
  disruption: null,
  eventsExamined: 4,
  tasksExamined: 2,
  existingConflicts: [],
  newConflicts: [],
  affectedEvents: [],
  protectedConstraints: [],
  taskAssessments: [],
  warnings: [],
  assessment: { status: 'no_conflicts', summary: 'No conflicts found.' },
  ...over,
});

export function dashboard(over: Partial<DashboardData> = {}): DashboardData {
  return {
    date: '2026-10-22',
    calendarTimeZone: 'Asia/Kolkata',
    taskTimeZone: 'Asia/Kolkata',
    utcOffset: '+05:30',
    window: { startTime: at('00:00'), endTime: at('00:00', '2026-10-23') },
    taskWindow: { startTime: at('00:00'), endTime: at('00:00', '2026-10-29') },
    events: EVENTS,
    tasks: TASKS,
    baseline: { window: { startTime: at('08:00'), endTime: at('20:00') }, analysis: emptyAnalysis() },
    baselineError: null,
    ...over,
  };
}

export const dashboardOk = (over: Partial<DashboardData> = {}): ApiResponse<DashboardData> => {
  const d = dashboard(over);
  return { ok: true, data: d, activity: [activity('get_schedule', `${d.events.length} events`), activity('get_tasks', `${d.tasks.length} tasks`), activity('analyze_conflicts', '0 existing conflicts (baseline)')] };
};

export const analysisWithConflict = (): ConflictAnalysis =>
  emptyAnalysis({
    disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
    existingConflicts: [
      { issueId: 'x1', category: 'event_overlap', severity: 'low', affectedEventIds: ['evt-003'], affectedTaskIds: [], description: 'Project Review already overlaps something.', interval: { startTime: at('13:30'), endTime: at('14:00') }, introducedByDisruption: false, resolvable: true, suggestedNextStep: 'Keep an eye on it.' },
    ],
    newConflicts: [
      { issueId: 'n1', category: 'event_overlap', severity: 'high', affectedEventIds: ['evt-001', 'evt-002'], affectedTaskIds: [], description: 'Team Meeting (11:30–13:10) overlaps Lunch Break (12:30–13:15) for 40 minutes.', interval: { startTime: at('12:30'), endTime: at('13:10') }, introducedByDisruption: true, resolvable: true, suggestedNextStep: 'Run propose_recovery_plan.' },
    ],
    affectedEvents: [{ eventId: 'evt-002', title: 'Lunch Break', impact: 'direct_overlap', canBeRescheduled: true, reason: 'Starts while the meeting is still running.' }],
    protectedConstraints: [{ eventId: 'evt-005', title: "Doctor's Appointment", startTime: at('16:30'), endTime: at('17:30'), priority: 'critical', reasons: ['critical_priority', 'user_protected'] }],
    taskAssessments: [{ taskId: 'task-002', title: 'Prepare for project review', deadline: at('13:30'), priority: 'high', estimatedDurationMinutes: 30, status: 'at_risk', baselineStatus: 'feasible', origin: 'disruption', cumulativeEffortMinutes: 30, availableMinutes: 50, slackMinutes: 20, note: 'Enough time, but only 20 minutes of margin.' }],
    assessment: { status: 'conflicts_resolvable', summary: '1 conflict found for Team Meeting running 40 minutes late.' },
  });

export function validation(over: Partial<ValidationResult> = {}): ValidationResult {
  return { planId: 'plan-a', isValid: true, checks: [{ name: 'no_overlaps', passed: true, severity: 'hard', eventId: null, taskId: null, message: 'ok' }, { name: 'protected_events', passed: true, severity: 'hard', eventId: null, taskId: null, message: 'ok' }], violations: [], warnings: [], taskAssessments: [], summary: 'Plan is valid: every hard constraint holds.', ...over };
}

export function plan(id: string, rank: number, strategy: RecoveryPlan['strategy'], over: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    planId: id,
    strategy,
    summary: `${strategy} summary`,
    startTime: at('08:00'),
    endTime: at('20:00'),
    protectedEventIds: ['evt-005'],
    disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
    changes: [{ eventId: 'evt-002', title: 'Lunch Break', originalStartTime: at('12:30'), originalEndTime: at('13:15'), proposedStartTime: at('13:10'), proposedEndTime: at('13:55'), reason: 'Its original slot overlapped Team Meeting.' }],
    unchangedProtectedEvents: [{ eventId: 'evt-005', title: "Doctor's Appointment", startTime: at('16:30'), endTime: at('17:30'), priority: 'critical', reasons: ['critical_priority', 'user_protected'] }],
    taskAssessments: [{ taskId: 'task-001', title: 'Complete project report', deadline: at('20:00'), priority: 'critical', estimatedDurationMinutes: 120, status: 'feasible', baselineStatus: 'feasible', origin: 'none', cumulativeEffortMinutes: 150, availableMinutes: 300, slackMinutes: 150, note: 'Capacity exists.' }],
    explanation: { changes: ['c'], unchanged: ['u'], rationale: [`Rationale for ${id}`], taskCapacity: ['All deadlines have capacity.'], limitations: ['Tasks are not placed in slots.'] },
    score: { total: 100 * rank, rank, hardViolations: 0, components: { changedEvents: 100, priorityWeightedDelay: 40, focusTime: 0, tightTransitions: 10, taskRisk: 0 }, formula: 'sum of penalties' },
    validation: validation({ planId: id }),
    ...over,
  };
}

export const planSet = (candidates: RecoveryPlan[], over: Partial<RecoveryPlanSet> = {}): RecoveryPlanSet => ({
  interval: { startTime: at('08:00'), endTime: at('20:00') },
  disruption: { type: 'event_overrun', eventId: 'evt-001', overrunMinutes: 40 },
  protectedEventIds: ['evt-005'],
  outcome: 'plans_found',
  candidates,
  discardedStrategies: [],
  infeasibility: null,
  rankingFormula: 'rank by penalty total, lower is better',
  warnings: [],
  summary: `${candidates.length} validated candidates.`,
  ...over,
});

export const okResponse = <T>(data: T, tool: ToolName, summary = 'ok'): ApiResponse<T> => ({ ok: true, data, activity: [activity(tool, summary)] });
export const errResponse = (code: ToolActivity['errorCode'] & string, message: string, tool: ToolName): ApiResponse<never> => ({ ok: false, error: { code, message }, activity: [activity(tool, message, 'error', code)] });
