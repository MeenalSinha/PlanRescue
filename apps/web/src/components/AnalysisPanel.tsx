import type { AnalyzeData } from '@/lib/api';
import type { Conflict, ScheduleEvent } from '@/lib/contract';
import { ASSESSMENT_LABEL, IMPACT_LABEL, PROTECTION_REASON_LABEL } from '@/lib/labels';
import { formatMinutes, rangeLabel } from '@/lib/time';
import { CapacityBadge, Notice, OriginTag, SeverityBadge, Spinner } from './ui';

interface Props {
  analysis: AnalyzeData;
  events: ScheduleEvent[];
  stale: boolean;
  generating: boolean;
  hasProposal: boolean;
  onGenerate(): void;
}

function ConflictItem({ conflict, titles }: { conflict: Conflict; titles: Map<string, string> }) {
  const names = conflict.affectedEventIds.map((id) => titles.get(id) ?? id);
  return (
    <li className="finding">
      <div className="finding-head">
        <SeverityBadge severity={conflict.severity} />
        <span className="tag">{conflict.category === 'event_overlap' ? 'Overlapping events' : 'Task deadline'}</span>
        {conflict.resolvable ? null : <span className="tag tag-warn">Appears unresolvable</span>}
      </div>
      <p>{conflict.description}</p>
      <p className="muted small">
        {names.length > 0 ? <>Events: {names.join(', ')}. </> : null}
        {conflict.interval ? <>Time: {rangeLabel(conflict.interval.startTime, conflict.interval.endTime)}.</> : null}
      </p>
      <p className="small">Next step: {conflict.suggestedNextStep}</p>
    </li>
  );
}

export function AnalysisPanel({ analysis, events, stale, generating, hasProposal, onGenerate }: Props) {
  const titles = new Map(events.map((e) => [e.id, e.title]));
  const status = analysis.assessment.status;
  const tone = status === 'no_conflicts' ? 'success' : status === 'conflicts_resolvable' ? 'warning' : 'danger';

  return (
    <div className="analysis">
      <Notice tone={tone} title={ASSESSMENT_LABEL[status] ?? status}>
        {analysis.assessment.summary}
      </Notice>

      {analysis.warnings.length > 0 ? (
        <Notice tone="warning" title="Warnings from the analysis">
          <ul className="plain">
            {analysis.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="split">
        <div>
          <h3>Caused by this disruption ({analysis.newConflicts.length})</h3>
          {analysis.newConflicts.length === 0 ? (
            <p className="empty-line">The disruption introduces no new conflicts.</p>
          ) : (
            <ul className="findings">
              {analysis.newConflicts.map((c) => (
                <ConflictItem key={c.issueId} conflict={c} titles={titles} />
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Already present before it ({analysis.existingConflicts.length})</h3>
          {analysis.existingConflicts.length === 0 ? (
            <p className="empty-line">The stored schedule has no existing conflicts in this window.</p>
          ) : (
            <ul className="findings">
              {analysis.existingConflicts.map((c) => (
                <ConflictItem key={c.issueId} conflict={c} titles={titles} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <h3>Affected events ({analysis.affectedEvents.length})</h3>
      {analysis.affectedEvents.length === 0 ? (
        <p className="empty-line">No other events are affected.</p>
      ) : (
        <ul className="findings compact">
          {analysis.affectedEvents.map((e) => (
            <li key={e.eventId} className="finding">
              <div className="finding-head">
                <strong>{e.title}</strong>
                <span className="tag">{IMPACT_LABEL[e.impact] ?? e.impact}</span>
                <span className={`tag ${e.canBeRescheduled ? '' : 'tag-lock'}`}>{e.canBeRescheduled ? 'Can be rescheduled' : 'Cannot be rescheduled'}</span>
              </div>
              <p className="muted small">{e.reason}</p>
            </li>
          ))}
        </ul>
      )}

      <h3>Events the planner will not move ({analysis.protectedConstraints.length})</h3>
      <ul className="findings compact">
        {analysis.protectedConstraints.map((p) => (
          <li key={p.eventId} className="finding">
            <div className="finding-head">
              <strong>{p.title}</strong>
              <span className="muted small">{rangeLabel(p.startTime, p.endTime)}</span>
            </div>
            <p className="small">{p.reasons.map((r) => PROTECTION_REASON_LABEL[r] ?? r).join(' · ')}</p>
          </li>
        ))}
      </ul>

      <h3>Task deadlines</h3>
      <p className="muted small">The engine estimates whether enough unoccupied calendar time remains before each deadline. It checks aggregate capacity; it does not assign tasks to specific time slots.</p>
      {analysis.taskAssessments.length === 0 ? (
        <p className="empty-line">No unfinished tasks with deadlines in this window.</p>
      ) : (
        <ul className="findings compact">
          {analysis.taskAssessments.map((t) => (
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
      )}

      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={onGenerate} disabled={generating || stale}>
          {generating ? <Spinner label="Generating plans…" /> : hasProposal ? 'Regenerate recovery plans' : 'Generate recovery plans'}
        </button>
        {stale ? <span className="small stale-note">The scenario above changed since this analysis. Analyze it again first.</span> : null}
      </div>
    </div>
  );
}
