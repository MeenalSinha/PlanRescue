import type { ActionHistoryItem } from '@/lib/contract';
import type { Remote } from '@/lib/useRecoveryApp';
import { Spinner, Notice } from './ui';

interface Props {
  history: Remote<ActionHistoryItem[]>;
  onRefresh(): void;
}

export function ActionHistoryPanel({ history, onRefresh }: Props) {
  return (
    <div className="action-history-panel" aria-labelledby="history-heading">
      <div className="history-header">
        <h2 id="history-heading">Persistent Action History</h2>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={history.status === 'loading'}
          onClick={onRefresh}
        >
          {history.status === 'loading' ? <Spinner label="Loading history…" /> : 'Refresh audit trail'}
        </button>
      </div>

      <p className="muted small">
        Permanent, append-only audit trail recorded in SQLite by the MCP server for plan persistence, approval,
        rejection, stale detection, and atomic schedule execution.
      </p>

      {history.status === 'loading' ? (
        <div className="card skeleton">
          <Spinner label="Loading action history from SQLite…" />
        </div>
      ) : null}

      {history.status === 'error' ? (
        <Notice tone="danger" title="Could not load action history">
          <p>{history.error.message}</p>
        </Notice>
      ) : null}

      {history.status === 'ready' ? (
        history.data.length === 0 ? (
          <p className="empty">No lifecycle actions recorded yet.</p>
        ) : (
          <ol className="history-list" aria-label="Action history records">
            {history.data.map((entry) => {
              const details = entry.details as Record<string, unknown>;
              const changes = Array.isArray(details?.changes)
                ? (details.changes as Array<{ eventId: string; title: string; from: string; to: string }>)
                : [];

              return (
                <li key={entry.id} className={`history-entry history-${entry.actionType}`}>
                  <div className="history-meta">
                    <span className={`status-badge status-${entry.actionType}`}>
                      {entry.actionType.toUpperCase().replace(/_/g, ' ')}
                    </span>
                    <time dateTime={entry.occurredAt} className="history-time">
                      {new Date(entry.occurredAt).toLocaleString()}
                    </time>
                    <span className="history-actor muted small">Actor: {entry.actor}</span>
                    {entry.recoveryPlanId ? (
                      <span className="history-plan-id muted small font-mono">
                        Plan: {entry.recoveryPlanId.slice(0, 8)}…
                      </span>
                    ) : null}
                  </div>
                  <p className="history-summary">{entry.summary}</p>
                  {changes.length > 0 ? (
                    <div className="history-changes">
                      <strong>Rescheduled events:</strong>
                      <ul>
                        {changes.map((c) => (
                          <li key={c.eventId}>
                            <strong>{c.title}:</strong> {c.from} → <span className="accent-text">{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )
      ) : null}
    </div>
  );
}
