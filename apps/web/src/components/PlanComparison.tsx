import { useState } from 'react';
import type { ProposeData, ValidateData } from '@/lib/api';
import type { RecoveryPlan, ScheduleEvent, Task } from '@/lib/contract';
import { OUTCOME_LABEL, PROTECTION_REASON_LABEL, SCORE_COMPONENT_LABEL, STRATEGY_LABEL } from '@/lib/labels';
import { clock, describeMove, offsetOf, rangeLabel } from '@/lib/time';
import type { Remote } from '@/lib/useRecoveryApp';
import { generateRecoveryDecisionReport, renderRecoveryDecisionReportMarkdown } from '@/lib/report';
import { Timeline, computeRange, type TimelineItem } from './ScheduleTimeline';
import { CapacityBadge, Notice, OriginTag, Spinner } from './ui';
import { ValidationPanel } from './ValidationPanel';

interface Props {
  proposal: ProposeData;
  events: ScheduleEvent[];
  tasks: Task[];
  utcOffset: string;
  selectedPlanId: string | null;
  validations: Record<string, Remote<ValidateData>>;
  executingPlanId?: string | null;
  onSelect(planId: string): void;
  onVerify(plan: RecoveryPlan): void;
  onApprove?(persistentId: string): Promise<unknown>;
  onReject?(persistentId: string): Promise<unknown>;
  onApply?(persistentId: string): Promise<unknown>;
}

function originalItems(events: ScheduleEvent[], disruptedId: string, overrunMinutes: number): TimelineItem[] {
  return events.map((e) => {
    const startMs = Date.parse(e.startTime);
    const endMs = Date.parse(e.endTime);
    const disrupted = e.id === disruptedId;
    return {
      id: e.id,
      title: e.title,
      startMs,
      endMs,
      ...(disrupted ? { overrunEndMs: endMs + overrunMinutes * 60_000 } : {}),
      timeLabel: rangeLabel(e.startTime, e.endTime),
      tone: disrupted ? 'disrupted' : e.movable ? 'movable' : 'fixed',
      priority: e.priority,
      tags: [],
    };
  });
}

function proposedItems(plan: RecoveryPlan, events: ScheduleEvent[]): TimelineItem[] {
  const moved = new Map(plan.changes.map((c) => [c.eventId, c]));
  const protectedIds = new Set(plan.unchangedProtectedEvents.map((p) => p.eventId));
  const out: TimelineItem[] = [];
  for (const e of events) {
    const change = moved.get(e.id);
    const disrupted = e.id === plan.disruption.eventId;
    const startIso = change ? change.proposedStartTime : e.startTime;
    const endIso = change ? change.proposedEndTime : e.endTime;
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    out.push({
      id: e.id,
      title: e.title,
      startMs,
      endMs,
      ...(disrupted ? { overrunEndMs: endMs + plan.disruption.overrunMinutes * 60_000 } : {}),
      timeLabel: rangeLabel(startIso, endIso),
      tone: change ? 'moved' : disrupted ? 'disrupted' : protectedIds.has(e.id) ? 'protected' : 'unchanged',
      priority: e.priority,
      tags: [],
    });
  }
  return out;
}

export function PlanComparison({
  proposal,
  events,
  tasks,
  utcOffset,
  selectedPlanId,
  validations,
  executingPlanId,
  onSelect,
  onVerify,
  onApprove,
  onReject,
  onApply,
}: Props) {
  const plan = proposal.candidates.find((c) => c.planId === selectedPlanId) ?? null;
  const eventTitles = new Map(events.map((e) => [e.id, e.title]));
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusExplanation = (status?: string) => {
    switch (status) {
      case 'approved':
        return 'You approved this plan. The calendar has not changed yet.';
      case 'applied':
        return 'The approved changes have been saved to your PlanRescue calendar.';
      case 'rejected':
        return 'This plan was rejected and cannot be applied.';
      case 'stale':
        return 'The underlying schedule changed after this plan was generated. Generate and review a fresh plan.';
      case 'proposed':
      default:
        return 'This plan has been saved and is awaiting your decision.';
    }
  };

  return (
    <div className="plans">
      <Notice
        tone={proposal.outcome === 'infeasible' ? 'danger' : proposal.outcome === 'no_changes_needed' ? 'success' : 'info'}
        title={OUTCOME_LABEL[proposal.outcome] ?? proposal.outcome}
      >
        {proposal.summary}
      </Notice>

      {proposal.warnings.length > 0 ? (
        <Notice tone="warning" title="Warnings">
          <ul className="plain">
            {proposal.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {actionError ? (
        <Notice tone="danger" title="Action Error">
          <p>{actionError}</p>
        </Notice>
      ) : null}

      {proposal.outcome === 'infeasible' || (proposal.candidates.length === 0 && proposal.outcome !== 'no_changes_needed') ? (
        <div className="infeasible">
          <h3>{proposal.outcome === 'infeasible' ? 'Why no plan satisfies every rule' : 'No candidates were returned'}</h3>
          {proposal.infeasibility ? (
            <>
              <p>{proposal.infeasibility.summary}</p>
              <ul className="findings compact">
                {proposal.infeasibility.reasons.map((r, i) => (
                  <li key={`${r.code}-${i}`} className="finding finding-bad">
                    <p>{r.message}</p>
                    {r.eventIds.length > 0 ? <p className="muted small">Events: {r.eventIds.map((id) => eventTitles.get(id) ?? id).join(', ')}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">The Recovery Engine returned no candidates and gave no further explanation.</p>
          )}
        </div>
      ) : null}

      {proposal.candidates.length > 0 ? (
        <>
          <p className="status-line" role="status">
            <strong>Recovery plan proposed — calendar unchanged.</strong> Nothing here can be applied in this version without explicit approval.
          </p>
          <div className="candidate-grid" role="group" aria-label="Candidate recovery plans">
            {proposal.candidates.map((c) => {
              const selected = c.planId === selectedPlanId;
              const status = c.savedStatus ?? 'proposed';
              return (
                <button
                  key={c.planId}
                  type="button"
                  className={`candidate ${selected ? 'selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(c.planId)}
                >
                  <span className="cand-top">
                    <span className="rank">#{c.score.rank}</span>
                    <span className="cand-name">{STRATEGY_LABEL[c.strategy]}</span>
                    <span className={`tag tag-status tag-${status}`}>{status.toUpperCase()}</span>
                    {c.score.rank === 1 ? <span className="tag tag-best">Recommended</span> : null}
                  </span>
                  <span className="cand-stats">
                    <span>
                      <strong>{c.changes.length}</strong> event{c.changes.length === 1 ? '' : 's'} changed
                    </span>
                    <span>
                      Penalty score <strong>{c.score.total}</strong> <span className="muted">(lower is better)</span>
                    </span>
                    <span className={c.validation.isValid ? 'ok-text' : 'bad-text'}>
                      {c.validation.isValid ? '✓ Passed validation when generated' : '✕ Failed validation'}
                    </span>
                  </span>
                  {c.persistentId ? (
                    <span className="cand-id muted small">ID: {c.persistentId.slice(0, 8)}…</span>
                  ) : null}
                  <span className="cand-summary">{c.summary}</span>
                </button>
              );
            })}
          </div>

          {plan ? (
            <div className="plan-actions-wrapper">
              <div className="plan-status-banner">
                <div>
                  <strong>Current Status: <span className={`status-badge status-${plan.savedStatus ?? 'proposed'}`}>{(plan.savedStatus ?? 'proposed').toUpperCase()}</span></strong>
                  <p className="muted small">{statusExplanation(plan.savedStatus)}</p>
                  {plan.persistentId ? (
                    <p className="muted small font-mono">Persistent ID: {plan.persistentId}</p>
                  ) : null}
                </div>
                <div className="plan-action-buttons">
                  {(!plan.savedStatus || plan.savedStatus === 'proposed') && plan.persistentId && onApprove ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        aria-label="Approve plan"
                        disabled={Boolean(executingPlanId)}
                        onClick={async () => {
                          setActionError(null);
                          const res = (await onApprove(plan.persistentId!)) as { ok: boolean; error?: { message: string } };
                          if (res && !res.ok && res.error) setActionError(res.error.message);
                        }}
                      >
                        {executingPlanId === plan.persistentId ? <Spinner label="Approving…" /> : 'Approve plan'}
                      </button>
                      {onReject ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-label="Reject plan"
                          disabled={Boolean(executingPlanId)}
                          onClick={async () => {
                            setActionError(null);
                            const res = (await onReject(plan.persistentId!)) as { ok: boolean; error?: { message: string } };
                            if (res && !res.ok && res.error) setActionError(res.error.message);
                          }}
                        >
                          Reject plan
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {plan.savedStatus === 'approved' && plan.persistentId && onApply ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-apply"
                        aria-label="Apply approved plan"
                        disabled={Boolean(executingPlanId)}
                        onClick={() => {
                          setActionError(null);
                          setShowApplyModal(true);
                        }}
                      >
                        {executingPlanId === plan.persistentId ? <Spinner label="Applying…" /> : 'Apply approved plan'}
                      </button>
                      {onReject ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-label="Cancel approval"
                          disabled={Boolean(executingPlanId)}
                          onClick={async () => {
                            setActionError(null);
                            const res = (await onReject(plan.persistentId!)) as { ok: boolean; error?: { message: string } };
                            if (res && !res.ok && res.error) setActionError(res.error.message);
                          }}
                        >
                          Cancel approval
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {plan.savedStatus === 'applied' ? (
                    <span className="applied-pill">✓ Applied to Calendar</span>
                  ) : null}
                </div>
              </div>

              {showApplyModal ? (
                <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="apply-confirm-title">
                  <div className="modal-card">
                    <h3 id="apply-confirm-title">Confirm Calendar Update</h3>
                    <p>
                      You are about to update your persistent PlanRescue calendar in SQLite with{' '}
                      <strong>{plan.changes.length} schedule modification{plan.changes.length === 1 ? '' : 's'}</strong>:
                    </p>
                    <ul className="modal-changes-list">
                      {plan.changes.map((c) => (
                        <li key={c.eventId}>
                          <strong>{c.title}:</strong> {rangeLabel(c.originalStartTime, c.originalEndTime)} →{' '}
                          <span className="accent-text">{rangeLabel(c.proposedStartTime, c.proposedEndTime)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="muted small">
                      This action will execute atomically against your SQLite calendar database via the approved plan application service.
                    </p>
                    <div className="modal-footer">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={Boolean(executingPlanId)}
                        onClick={() => setShowApplyModal(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={Boolean(executingPlanId)}
                        onClick={async () => {
                          setShowApplyModal(false);
                          if (onApply && plan.persistentId) {
                            const res = (await onApply(plan.persistentId)) as { ok: boolean; error?: { message: string } };
                            if (res && !res.ok && res.error) setActionError(res.error.message);
                          }
                        }}
                      >
                        Confirm & Apply Changes
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <PlanDetail
                plan={plan}
                events={events}
                tasks={tasks}
                utcOffset={utcOffset}
                validation={validations[plan.planId]}
                onVerify={() => onVerify(plan)}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {proposal.discardedStrategies.length > 0 ? (
        <details className="more">
          <summary>Strategies not offered ({proposal.discardedStrategies.length})</summary>
          <ul className="plain">
            {proposal.discardedStrategies.map((d) => (
              <li key={d.strategy}>
                <strong>{STRATEGY_LABEL[d.strategy as RecoveryPlan['strategy']] ?? d.strategy}:</strong> {d.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details className="more">
        <summary>How candidates are ranked</summary>
        <p className="small">{proposal.rankingFormula}</p>
        <p className="muted small">The score is a deterministic penalty total, so lower is better. It is not a percentage, a probability or an AI confidence value.</p>
      </details>
    </div>
  );
}

function PlanDetail({
  plan,
  events,
  tasks,
  utcOffset,
  validation,
  onVerify,
}: {
  plan: RecoveryPlan;
  events: ScheduleEvent[];
  tasks: Task[];
  utcOffset: string;
  validation: Remote<ValidateData> | undefined;
  onVerify(): void;
}) {
  const left = originalItems(events, plan.disruption.eventId, plan.disruption.overrunMinutes);
  const right = proposedItems(plan, events);
  const range = computeRange([...left, ...right], utcOffset);
  const disrupted = events.find((e) => e.id === plan.disruption.eventId);
  const components = Object.entries(plan.score.components).flatMap(([k, v]): Array<[string, number]> => (typeof v === 'number' ? [[k, v]] : []));

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTab, setReportTab] = useState<'preview' | 'markdown' | 'json'>('preview');

  const report = generateRecoveryDecisionReport({
    plan,
    events,
    tasks,
    timeZone: `UTC${utcOffset}`,
  });
  const markdown = renderRecoveryDecisionReportMarkdown(report);

  function downloadBlob(content: string, filename: string, contentType: string) {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <article className="plan-detail" aria-label={`${STRATEGY_LABEL[plan.strategy]} plan details`}>
      <header>
        <h3>
          #{plan.score.rank} {STRATEGY_LABEL[plan.strategy]}
        </h3>
        <p>{plan.summary}</p>
      </header>

      <section aria-labelledby={`chg-${plan.planId}`}>
        <h4 id={`chg-${plan.planId}`}>Changes to the schedule ({plan.changes.length})</h4>
        {disrupted ? (
          <p className="muted small">
            Reported disruption: {disrupted.title} runs {plan.disruption.overrunMinutes} min longer, ending at about {clock(shiftIso(disrupted.endTime, plan.disruption.overrunMinutes))}. Its start does not change.
          </p>
        ) : null}
        {plan.changes.length === 0 ? (
          <p className="empty-line">No events need to move.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Events that move in this plan</caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Original time</th>
                  <th scope="col">Proposed time</th>
                  <th scope="col">Change</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {plan.changes.map((c) => (
                  <tr key={c.eventId}>
                    <th scope="row">{c.title}</th>
                    <td>
                      {rangeLabel(c.originalStartTime, c.originalEndTime)}
                      <span className="muted small"> (UTC{offsetOf(c.originalStartTime)})</span>
                    </td>
                    <td>
                      <strong>{rangeLabel(c.proposedStartTime, c.proposedEndTime)}</strong>
                      <span className="muted small"> (UTC{offsetOf(c.proposedStartTime)})</span>
                    </td>
                    <td>{describeMove(c.originalStartTime, c.proposedStartTime)}</td>
                    <td>{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby={`cmp-${plan.planId}`}>
        <h4 id={`cmp-${plan.planId}`}>Original versus proposed</h4>
        <div className="compare">
          <div>
            <p className="compare-title">Stored schedule</p>
            <Timeline items={left} range={range} label="Original schedule" />
          </div>
          <div>
            <p className="compare-title">With this plan</p>
            <Timeline items={right} range={range} label="Proposed schedule" />
          </div>
        </div>
      </section>

      <section aria-labelledby={`prot-${plan.planId}`}>
        <h4 id={`prot-${plan.planId}`}>Protected events — unchanged ({plan.unchangedProtectedEvents.length})</h4>
        {plan.unchangedProtectedEvents.length === 0 ? (
          <p className="empty-line">This plan lists no protected events.</p>
        ) : (
          <ul className="findings compact">
            {plan.unchangedProtectedEvents.map((p) => (
              <li key={p.eventId} className="finding">
                <div className="finding-head">
                  <strong>{p.title}</strong>
                  <span>{rangeLabel(p.startTime, p.endTime)}</span>
                  {p.reasons.includes('disrupted_event') ? <span className="tag tag-warn">Start not moved; ran late as reported</span> : <span className="tag tag-lock">Unchanged in this plan</span>}
                </div>
                <p className="muted small">Protected because: {p.reasons.map((r) => PROTECTION_REASON_LABEL[r] ?? r).join(', ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`task-${plan.planId}`}>
        <h4 id={`task-${plan.planId}`}>Task deadlines</h4>
        <p className="muted small">The Recovery Engine assesses aggregate task capacity (is there enough unoccupied calendar time before each deadline?). It does not assign tasks to precise calendar slots.</p>
        {plan.explanation.taskCapacity.length > 0 ? (
          <ul className="plain">
            {plan.explanation.taskCapacity.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <ul className="findings compact">
          {plan.taskAssessments.map((t) => (
            <li key={t.taskId} className="finding">
              <div className="finding-head">
                <strong>{t.title}</strong>
                <CapacityBadge status={t.status} />
                <OriginTag origin={t.origin} />
              </div>
              <p className="muted small">{t.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`why-${plan.planId}`}>
        <h4 id={`why-${plan.planId}`}>Why this plan, and the trade-offs</h4>
        <ul className="plain">
          {plan.explanation.rationale.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="small">
          Penalty score <strong>{plan.score.total}</strong> (lower is better):
        </p>
        <ul className="score-parts">
          {components.map(([k, v]) => (
            <li key={k}>
              <span>{SCORE_COMPONENT_LABEL[k] ?? k}</span>
              <strong>{v}</strong>
            </li>
          ))}
        </ul>
        {plan.explanation.limitations.length > 0 ? (
          <details className="more">
            <summary>Limits of this plan</summary>
            <ul className="plain">
              {plan.explanation.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section aria-labelledby={`val-${plan.planId}`}>
        <h4 id={`val-${plan.planId}`}>Independent validation</h4>
        <ValidationPanel plan={plan} state={validation} events={events} tasks={tasks} onVerify={onVerify} />
      </section>

      <section aria-labelledby={`report-${plan.planId}`} className="decision-report-section">
        <div className="report-section-header">
          <div>
            <h4 id={`report-${plan.planId}`}>Recovery Decision Report &amp; Explainability</h4>
            <p className="muted small">
              Audit-grade recovery decision report detailing disruption context, schedule diff, protected constraints, and deterministic rationale.
            </p>
          </div>
          <div className="report-export-buttons">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowReportModal(true)}
              aria-label="Inspect recovery decision report"
            >
              📄 Inspect Report
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => downloadBlob(markdown, `planrescue-report-${plan.planId}.md`, 'text/markdown')}
              aria-label="Export report as Markdown"
            >
              ⬇️ Export .md
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => downloadBlob(JSON.stringify(report, null, 2), `planrescue-report-${plan.planId}.json`, 'application/json')}
              aria-label="Export report as JSON"
            >
              ⬇️ Export .json
            </button>
          </div>
        </div>

        <div className="report-highlights">
          <div className="report-highlight-pill">
            <span className="muted small">Status:</span>
            <strong>{(plan.savedStatus ?? 'proposed').toUpperCase()}</strong>
          </div>
          <div className="report-highlight-pill">
            <span className="muted small">Penalty:</span>
            <strong>{plan.score.total}</strong>
          </div>
          <div className="report-highlight-pill">
            <span className="muted small">Rescheduled:</span>
            <strong>{plan.changes.length} event(s)</strong>
          </div>
          <div className="report-highlight-pill">
            <span className="muted small">Protected:</span>
            <strong>{plan.unchangedProtectedEvents.length} preserved</strong>
          </div>
          <div className="report-highlight-pill">
            <span className="muted small">Validation:</span>
            <strong className={plan.validation.isValid ? 'ok-text' : 'bad-text'}>
              {plan.validation.isValid ? '✓ Valid' : '✕ Invalid'}
            </strong>
          </div>
        </div>

        {showReportModal ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={`report-modal-title-${plan.planId}`}>
            <div className="modal-card modal-card-lg">
              <div className="modal-header">
                <h3 id={`report-modal-title-${plan.planId}`}>Recovery Decision Report</h3>
                <div className="modal-tabs">
                  <button
                    type="button"
                    className={`btn-tab ${reportTab === 'preview' ? 'active' : ''}`}
                    onClick={() => setReportTab('preview')}
                  >
                    Structured View
                  </button>
                  <button
                    type="button"
                    className={`btn-tab ${reportTab === 'markdown' ? 'active' : ''}`}
                    onClick={() => setReportTab('markdown')}
                  >
                    Markdown (.md)
                  </button>
                  <button
                    type="button"
                    className={`btn-tab ${reportTab === 'json' ? 'active' : ''}`}
                    onClick={() => setReportTab('json')}
                  >
                    JSON (.json)
                  </button>
                </div>
              </div>

              <div className="modal-body-scrollable">
                {reportTab === 'preview' ? (
                  <div className="report-preview-pane">
                    <div className="report-meta-box">
                      <p><strong>Report ID:</strong> {report.metadata.reportId}</p>
                      <p><strong>Status:</strong> <span className={`tag tag-status tag-${report.metadata.status}`}>{report.metadata.status.toUpperCase()}</span></p>
                      <p><strong>Generated:</strong> {report.metadata.generatedAt}</p>
                      <p><strong>Plan ID:</strong> {report.metadata.planId}</p>
                      <p><strong>Snapshot Hash:</strong> <code>{report.metadata.snapshotHash}</code></p>
                    </div>

                    <h5>Executive Summary</h5>
                    <p>{report.recommendedPlan.summary}</p>

                    <h5>Disruption Details</h5>
                    <p>{report.disruption.description}</p>

                    <h5>Rescheduled Events ({report.recommendedPlan.changesCount})</h5>
                    {report.recommendedPlan.changes.length === 0 ? (
                      <p className="muted small">No events rescheduled.</p>
                    ) : (
                      <table className="compact-table">
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Original</th>
                            <th>Proposed</th>
                            <th>Shift</th>
                            <th>Preserved</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.recommendedPlan.changes.map((c) => (
                            <tr key={c.eventId}>
                              <td>{c.title}</td>
                              <td>{rangeLabel(c.originalStartTime, c.originalEndTime)}</td>
                              <td><strong>{rangeLabel(c.proposedStartTime, c.proposedEndTime)}</strong></td>
                              <td>{c.shiftMinutes >= 0 ? `+${c.shiftMinutes}m` : `${c.shiftMinutes}m`}</td>
                              <td>{c.durationPreserved ? '✓ Yes' : '✕ No'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <h5>Decision Rationale &amp; Penalty Scoring</h5>
                    <p className="muted small">{report.decisionRationale.scoringNotice}</p>
                    <ul className="plain">
                      {report.decisionRationale.tradeoffs.map((t, idx) => (
                        <li key={idx}>• {t}</li>
                      ))}
                    </ul>
                  </div>
                ) : reportTab === 'markdown' ? (
                  <pre className="report-code-block font-mono">{markdown}</pre>
                ) : (
                  <pre className="report-code-block font-mono">{JSON.stringify(report, null, 2)}</pre>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReportModal(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => downloadBlob(markdown, `planrescue-report-${plan.planId}.md`, 'text/markdown')}
                >
                  Export Markdown
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => downloadBlob(JSON.stringify(report, null, 2), `planrescue-report-${plan.planId}.json`, 'application/json')}
                >
                  Export JSON
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </article>
  );
}

/** Wall-clock end of an overrunning event, kept in the event's own offset (display only). */
function shiftIso(iso: string, minutes: number): string {
  const ms = Date.parse(iso) + minutes * 60_000;
  const off = offsetOf(iso);
  const sign = off.startsWith('-') ? -1 : 1;
  const [h, m] = off.slice(1).split(':').map(Number) as [number, number];
  return new Date(ms + sign * (h * 60 + m) * 60_000).toISOString().replace('Z', off);
}
