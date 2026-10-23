import type { ReactNode } from 'react';
import type { CapacityStatus, Priority, RiskOrigin } from '@/lib/contract';
import { CAPACITY_LABEL, ORIGIN_LABEL, PRIORITY_LABEL } from '@/lib/labels';

export function SeverityBadge({ severity }: { severity: Priority }) {
  const icon = { critical: '▲▲', high: '▲', medium: '●', low: 'i' }[severity];
  return (
    <span className={`badge sev sev-${severity}`}>
      <span aria-hidden="true">{icon}</span> {PRIORITY_LABEL[severity]}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  return <span className={`tag prio-${priority}`}>{PRIORITY_LABEL[priority]} priority</span>;
}

export function CapacityBadge({ status }: { status: CapacityStatus }) {
  const icon = { feasible: '✓', at_risk: '!', infeasible: '✕', not_assessed: '–' }[status];
  return (
    <span className={`badge cap cap-${status}`}>
      <span aria-hidden="true">{icon}</span> {CAPACITY_LABEL[status]}
    </span>
  );
}

export function OriginTag({ origin }: { origin: RiskOrigin }) {
  if (origin === 'none') return null;
  return <span className={`tag origin-${origin}`}>{ORIGIN_LABEL[origin]}</span>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function Notice({
  tone,
  title,
  children,
  action,
  live = 'polite',
}: {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  live?: 'polite' | 'assertive' | 'off';
}) {
  return (
    <div className={`notice notice-${tone}`} role={live === 'assertive' ? 'alert' : 'status'} aria-live={live}>
      <div className="notice-body">
        <p className="notice-title">{title}</p>
        {children ? <div className="notice-text">{children}</div> : null}
      </div>
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

export function SectionCard({ title, id, subtitle, children, actions }: { title: string; id?: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="card" id={id} aria-labelledby={headingId}>
      <header className="card-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
