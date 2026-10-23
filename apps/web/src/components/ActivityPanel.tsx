import type { ToolActivity, ToolName } from '@/lib/api';
import type { Connection, PendingCall } from '@/lib/useRecoveryApp';

const TOOLS: ToolName[] = ['get_schedule', 'get_tasks', 'analyze_conflicts', 'propose_recovery_plan', 'validate_recovery_plan'];

export function ConnectionBadge({ connection }: { connection: Connection }) {
  const text = { connecting: 'Connecting to MCP server…', connected: 'MCP server connected', unavailable: 'MCP server temporarily unavailable' }[connection];
  const icon = { connecting: '…', connected: '●', unavailable: '✕' }[connection];
  return (
    <span className={`conn conn-${connection}`} role="status">
      <span aria-hidden="true">{icon}</span> {text}
    </span>
  );
}

function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

/** Compact roster plus recent call log. Every row is a real call the server made over MCP. */
export function ActivityPanel({ log, pending, connection, full = false }: { log: ToolActivity[]; pending: PendingCall[]; connection: Connection; full?: boolean }) {
  const latest = new Map<ToolName, ToolActivity>();
  for (const a of log) if (!latest.has(a.tool)) latest.set(a.tool, a);
  const shown = full ? log : log.slice(0, 8);

  return (
    <aside className="activity" aria-labelledby="activity-heading">
      <h2 id="activity-heading">MCP tool activity</h2>
      <ConnectionBadge connection={connection} />
      <ul className="roster">
        {TOOLS.map((tool) => {
          const isPending = pending.some((p) => p.tool === tool);
          const last = latest.get(tool);
          let icon = '○';
          let text = 'Not called yet';
          let cls = 'idle';
          if (isPending) {
            icon = '◔';
            text = 'Running…';
            cls = 'running';
          } else if (last) {
            icon = last.status === 'success' ? '✓' : '✕';
            text = last.status === 'success' ? last.summary : `Failed: ${last.summary}`;
            cls = last.status;
          }
          return (
            <li key={tool} className={`roster-item roster-${cls}`}>
              <span className="roster-icon" aria-hidden="true">
                {icon}
              </span>
              <span>
                <code>{tool}</code>
                <span className="roster-text">{text}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <h3>{full ? 'All calls this session' : 'Recent calls'}</h3>
      {shown.length === 0 ? (
        <p className="muted small">No calls yet.</p>
      ) : (
        <ol className="calllog" aria-label="MCP calls, newest first">
          {shown.map((a) => (
            <li key={a.id} className={`call call-${a.status}`}>
              <span className="call-time">{timeOf(a.startedAt)}Z</span>
              <code>{a.tool}</code>
              <span className="call-status">{a.status === 'success' ? '✓ ok' : '✕ error'}</span>
              <span className="call-ms">{a.durationMs} ms</span>
              <span className="call-summary">{a.summary}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">History covers this browser session only. It is not stored and is cleared on reload.</p>
      <span hidden>{connection}</span>
    </aside>
  );
}
