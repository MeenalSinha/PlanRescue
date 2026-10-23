'use client';

/**
 * Client state for the whole workflow. The hook only moves data between the user, the API routes and
 * the screen: it never computes a schedule, a conflict, a score or a verdict itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyzeData, ApiError, ApiResponse, DashboardData, ProposeData, ToolActivity, ToolName, ValidateData } from './api';
import { DEFAULT_DATE, DEFAULT_PLANNING_END, DEFAULT_PLANNING_START } from './constants';
import type { RecoveryPlan } from './contract';
import { analyzeRequestSchema, fieldErrors, proposeRequestSchema, type AnalyzeRequest, type ProposeRequest } from './requests';
import { withOffset } from './time';

export type Connection = 'connecting' | 'connected' | 'unavailable';

export interface ScenarioForm {
  startLocal: string;
  endLocal: string;
  eventId: string;
  overrun: string;
  protectedIds: string[];
  optimizeFor: 'minimal_disruption' | 'transition_time';
}

export type Remote<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiError };

export interface PendingCall {
  id: string;
  tool: ToolName;
}

const TRANSPORT_CODES = new Set(['mcp_unavailable', 'mcp_timeout', 'network_error', 'misconfigured', 'internal_error', 'bad_response']);

/** POST/GET an application route and normalise every failure into the same envelope. */
export async function callApi<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: { code: 'network_error', message: 'Could not reach the PlanRescue web server. Check that it is still running.' }, activity: [] };
  }
  try {
    const body = (await res.json()) as ApiResponse<T>;
    if (typeof body === 'object' && body !== null && 'ok' in body && Array.isArray(body.activity)) return body;
  } catch {
    // fall through
  }
  return { ok: false, error: { code: 'bad_response', message: 'The server sent a response the application could not read.' }, activity: [] };
}

function post<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  return callApi<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function defaultForm(date: string): ScenarioForm {
  return {
    startLocal: `${date}T${DEFAULT_PLANNING_START}`,
    endLocal: `${date}T${DEFAULT_PLANNING_END}`,
    eventId: '',
    overrun: '40',
    protectedIds: [],
    optimizeFor: 'minimal_disruption',
  };
}

/** Turn the form into an API request body, or field-keyed errors. */
export function buildRequest(form: ScenarioForm, offset: string): { ok: true; analyze: AnalyzeRequest; propose: ProposeRequest } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!form.eventId) errors['disruption.eventId'] = 'Choose the event that ran late';
  if (!form.startLocal) errors['startTime'] = 'Enter when the planning window starts';
  if (!form.endLocal) errors['endTime'] = 'Enter when the planning window ends';
  const overrunText = form.overrun.trim();
  const overrun = overrunText === '' ? Number.NaN : Number(overrunText);
  if (overrunText === '' || Number.isNaN(overrun)) errors['disruption.overrunMinutes'] = 'Enter the overrun as a whole number of minutes';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const base = {
    startTime: withOffset(form.startLocal, offset),
    endTime: withOffset(form.endLocal, offset),
    disruption: { type: 'event_overrun' as const, eventId: form.eventId, overrunMinutes: overrun },
    ...(form.protectedIds.length > 0 ? { protectedEventIds: form.protectedIds } : {}),
  };
  const analyze = analyzeRequestSchema.safeParse(base);
  const propose = proposeRequestSchema.safeParse({ ...base, preferences: { optimizeFor: form.optimizeFor } });
  if (!analyze.success) return { ok: false, errors: fieldErrors(analyze.error) };
  if (!propose.success) return { ok: false, errors: fieldErrors(propose.error) };
  return { ok: true, analyze: analyze.data, propose: propose.data };
}

export function useRecoveryApp() {
  const [date, setDate] = useState(DEFAULT_DATE);
  const [dashboard, setDashboard] = useState<Remote<DashboardData>>({ status: 'loading' });
  const [lastData, setLastData] = useState<DashboardData | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [form, setFormState] = useState<ScenarioForm>(() => defaultForm(DEFAULT_DATE));
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<Remote<AnalyzeData>>({ status: 'idle' });
  const [analyzedRequest, setAnalyzedRequest] = useState<ProposeRequest | null>(null);
  const [proposal, setProposal] = useState<Remote<ProposeData>>({ status: 'idle' });
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [validations, setValidations] = useState<Record<string, Remote<ValidateData>>>({});
  const [log, setLog] = useState<ToolActivity[]>([]);
  const [pending, setPending] = useState<PendingCall[]>([]);
  const dashboardSeq = useRef(0);
  const scenarioSeq = useRef(0);

  const record = useCallback((activity: ToolActivity[], response: ApiResponse<unknown>) => {
    if (activity.length > 0) setLog((prev) => [...activity.slice().reverse(), ...prev].slice(0, 100));
    if (response.ok) setConnection('connected');
    else setConnection(TRANSPORT_CODES.has(response.error.code) ? 'unavailable' : 'connected');
  }, []);

  const track = useCallback(async <T,>(tools: ToolName[], run: () => Promise<ApiResponse<T>>): Promise<ApiResponse<T>> => {
    const entries = tools.map((tool) => ({ id: `${tool}-${Math.random().toString(36).slice(2)}`, tool }));
    setPending((p) => [...p, ...entries]);
    try {
      return await run();
    } finally {
      setPending((p) => p.filter((e) => !entries.some((x) => x.id === e.id)));
    }
  }, []);

  const loadDashboard = useCallback(
    async (forDate: string) => {
      const seq = ++dashboardSeq.current;
      setDashboard({ status: 'loading' });
      setConnection('connecting');
      const res = await track<DashboardData>(['get_schedule', 'get_tasks', 'analyze_conflicts'], () => callApi<DashboardData>(`/api/dashboard?date=${encodeURIComponent(forDate)}`));
      if (seq !== dashboardSeq.current) return;
      record(res.activity, res);
      if (res.ok) {
        setDashboard({ status: 'ready', data: res.data });
        setLastData(res.data);
        // Keep what the user already typed; only fix an event choice that no longer exists on this day.
        setFormState((f) => (f.eventId && !res.data.events.some((e) => e.id === f.eventId) ? { ...f, eventId: '', protectedIds: [] } : f));
      } else {
        setDashboard({ status: 'error', error: res.error });
      }
    },
    [record, track],
  );

  useEffect(() => {
    void loadDashboard(date);
    // The first load runs once; later loads are triggered explicitly by refresh, retry and date change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetResults = useCallback(() => {
    scenarioSeq.current += 1;
    setAnalysis({ status: 'idle' });
    setAnalyzedRequest(null);
    setProposal({ status: 'idle' });
    setSelectedPlanId(null);
    setValidations({});
  }, []);

  const changeDate = useCallback(
    (next: string) => {
      setDate(next);
      setLastData(null);
      setFormState((f) => ({ ...defaultForm(next), optimizeFor: f.optimizeFor }));
      setFormErrors({});
      resetResults();
      void loadDashboard(next);
    },
    [loadDashboard, resetResults],
  );

  const setForm = useCallback((patch: Partial<ScenarioForm>) => {
    setFormState((f) => {
      const next = { ...f, ...patch };
      // The event that ran late cannot also be "protected".
      if (patch.eventId) next.protectedIds = next.protectedIds.filter((id) => id !== patch.eventId);
      return next;
    });
    setFormErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      if ('eventId' in patch) delete next['disruption.eventId'];
      if ('overrun' in patch) delete next['disruption.overrunMinutes'];
      if ('startLocal' in patch) delete next['startTime'];
      if ('endLocal' in patch) delete next['endTime'];
      return next;
    });
  }, []);

  const offset = dashboard.status === 'ready' ? dashboard.data.utcOffset : null;

  const analyze = useCallback(async () => {
    if (!offset) return;
    const built = buildRequest(form, offset);
    if (!built.ok) {
      setFormErrors(built.errors);
      return;
    }
    setFormErrors({});
    const seq = ++scenarioSeq.current;
    setProposal({ status: 'idle' });
    setSelectedPlanId(null);
    setValidations({});
    setAnalyzedRequest(null);
    setAnalysis({ status: 'loading' });
    const res = await track<AnalyzeData>(['analyze_conflicts'], () => post<AnalyzeData>('/api/recovery/analyze', built.analyze));
    if (seq !== scenarioSeq.current) return;
    record(res.activity, res);
    if (res.ok) {
      setAnalysis({ status: 'ready', data: res.data });
      setAnalyzedRequest(built.propose);
    } else {
      if (res.error.code === 'invalid_request' && res.error.fields) setFormErrors(res.error.fields);
      setAnalysis({ status: 'error', error: res.error });
    }
  }, [form, offset, record, track]);

  const generatePlans = useCallback(async () => {
    if (!analyzedRequest) return;
    const seq = ++scenarioSeq.current;
    setSelectedPlanId(null);
    setValidations({});
    setProposal({ status: 'loading' });
    const res = await track<ProposeData>(['propose_recovery_plan'], () => post<ProposeData>('/api/recovery/propose', analyzedRequest));
    if (seq !== scenarioSeq.current) return;
    record(res.activity, res);
    if (res.ok) {
      setProposal({ status: 'ready', data: res.data });
      setSelectedPlanId(res.data.candidates[0]?.planId ?? null);
    } else {
      setProposal({ status: 'error', error: res.error });
    }
  }, [analyzedRequest, record, track]);

  const verifyPlan = useCallback(
    async (plan: RecoveryPlan) => {
      setValidations((v) => ({ ...v, [plan.planId]: { status: 'loading' } }));
      // The candidate is sent exactly as the Recovery Engine returned it.
      const res = await track<ValidateData>(['validate_recovery_plan'], () => post<ValidateData>('/api/recovery/validate', plan));
      record(res.activity, res);
      setValidations((v) => ({ ...v, [plan.planId]: res.ok ? { status: 'ready', data: res.data } : { status: 'error', error: res.error } }));
    },
    [record, track],
  );

  /** True when the form no longer describes the scenario that was analysed. */
  const scenarioChanged = useMemo(() => {
    if (!analyzedRequest || !offset) return false;
    const built = buildRequest(form, offset);
    if (!built.ok) return true;
    return JSON.stringify(built.propose) !== JSON.stringify(analyzedRequest);
  }, [analyzedRequest, form, offset]);

  return {
    date,
    dashboard,
    lastData,
    connection,
    form,
    formErrors,
    analysis,
    analyzedRequest,
    proposal,
    selectedPlanId,
    validations,
    log,
    pending,
    scenarioChanged,
    setForm,
    setSelectedPlanId,
    changeDate,
    refresh: () => loadDashboard(date),
    analyze,
    generatePlans,
    verifyPlan,
  };
}
