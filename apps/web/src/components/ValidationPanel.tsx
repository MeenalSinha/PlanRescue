import type { ApiError, ValidateData } from '@/lib/api';
import type { RecoveryPlan, ScheduleEvent, Task } from '@/lib/contract';
import { CHECK_LABEL } from '@/lib/labels';
import type { Remote } from '@/lib/useRecoveryApp';
import { formatMinutes } from '@/lib/time';
import { CapacityBadge, Notice, OriginTag, Spinner } from './ui';

interface Props {
  plan: RecoveryPlan;
  state: Remote<ValidateData> | undefined;
  events: ScheduleEvent[];
  tasks: Task[];
  onVerify(): void;
}

function errorTitle(error: ApiError): string {
  if (error.code === 'mcp_tool_error') return 'The validation tool reported an error';
  if (error.code === 'mcp_unavailable' || error.code === 'mcp_timeout' || error.code === 'network_error') return 'Validation could not be completed';
  return 'Validation failed to run';
}

export function ValidationPanel({ plan, state, events, tasks, onVerify }: Props) {
  const eventTitle = (id: string | null): string | null => (id ? (events.find((e) => e.id === id)?.title ?? id) : null);
  const taskTitle = (id: string | null): string | null => (id ? (tasks.find((t) => t.id === id)?.title ?? id) : null);
  const running = state?.status === 'loading';

  return (
    <div className="validation">
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onVerify} disabled={running}>
          {running ? <Spinner label="Verifying…" /> : state?.status === 'ready' ? 'Verify this plan again' : 'Verify this plan'}
        </button>
        <span className="muted small">The validator reloads the stored calendar and tasks and re-checks this plan from scratch. It trusts nothing the plan says about itself.</span>
      </div>

      {state?.status === 'error' ? (
        <Notice
          tone="danger"
          live="assertive"
          title={errorTitle(state.error)}
          action={
            <button type="button" className="btn btn-small" onClick={onVerify}>
              Try again
            </button>
          }
        >
          {state.error.message} This is a problem running the check, not a verdict on the plan: it has not been shown to be valid or invalid.
        </Notice>
      ) : null}

      {state?.status === 'ready' ? (
        <div className="validation-result" aria-live="polite">
          <Notice tone={state.data.isValid ? 'success' : 'danger'} title={state.data.isValid ? '✓ Plan is valid' : '✕ Plan is invalid'}>
            {state.data.summary}
          </Notice>

          {state.data.violations.length > 0 ? (
            <>
              <h4>Hard constraint violations ({state.data.violations.length})</h4>
              <ul className="findings compact">
                {state.data.violations.map((v, i) => (
                  <li key={`${v.check}-${i}`} className="finding finding-bad">
                    <div className="finding-head">
                      <strong>{CHECK_LABEL[v.check] ?? v.check}</strong>
                      {eventTitle(v.eventId) ? <span className="tag">Event: {eventTitle(v.eventId)}</span> : null}
                      {taskTitle(v.taskId) ? <span className="tag">Task: {taskTitle(v.taskId)}</span> : null}
                    </div>
                    <p>{v.message}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {state.data.warnings.length > 0 ? (
            <>
              <h4>Warnings ({state.data.warnings.length})</h4>
              <ul className="findings compact">
                {state.data.warnings.map((w, i) => (
                  <li key={`${w.check}-${i}`} className="finding">
                    <div className="finding-head">
                      <strong>{CHECK_LABEL[w.check] ?? w.check}</strong>
                      {eventTitle(w.eventId) ? <span className="tag">Event: {eventTitle(w.eventId)}</span> : null}
                      {taskTitle(w.taskId) ? <span className="tag">Task: {taskTitle(w.taskId)}</span> : null}
                    </div>
                    <p>{w.message}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <ChecksSummary result={state.data} />

          {state.data.taskAssessments.length > 0 ? (
            <>
              <h4>Task capacity under this plan</h4>
              <ul className="findings compact">
                {state.data.taskAssessments.map((t) => (
                  <li key={t.taskId} className="finding">
                    <div className="finding-head">
                      <strong>{t.title}</strong>
                      <CapacityBadge status={t.status} />
                      <OriginTag origin={t.origin} />
                    </div>
                    <p className="muted small">
                      {t.note}
                      {t.slackMinutes !== null ? ` Margin: ${formatMinutes(t.slackMinutes)}.` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      <p className="muted small">Validation checks a plan. It does not apply it: the stored calendar is unchanged.</p>
      <span hidden>{plan.planId}</span>
    </div>
  );
}

function ChecksSummary({ result }: { result: ValidateData }) {
  const failed = new Set(result.violations.map((v) => v.check));
  const passed = [...new Set(result.checks.filter((c) => c.passed).map((c) => c.name))].filter((n) => !failed.has(n));
  const failing = [...failed];
  return (
    <>
      <h4>Checks</h4>
      <ul className="check-grid">
        {passed.map((n) => (
          <li key={n} className="check-pass">
            <span aria-hidden="true">✓</span> <span className="sr-only">Passed: </span>
            {CHECK_LABEL[n] ?? n}
          </li>
        ))}
        {failing.map((n) => (
          <li key={n} className="check-fail">
            <span aria-hidden="true">✕</span> <span className="sr-only">Failed: </span>
            {CHECK_LABEL[n] ?? n}
          </li>
        ))}
      </ul>
    </>
  );
}
