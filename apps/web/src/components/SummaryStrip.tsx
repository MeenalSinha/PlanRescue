import type { DashboardData } from '@/lib/api';
import { dateTimeLabel, formatMinutes } from '@/lib/time';

export function SummaryStrip({ data }: { data: DashboardData }) {
  const booked = data.events.reduce((sum, e) => sum + e.durationMinutes, 0);
  const open = data.tasks.filter((t) => t.status !== 'completed');
  const next = open.map((t) => t.deadline).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const baseline = data.baseline?.analysis;

  const stats = [
    {
      label: 'Events today',
      value: String(data.events.length),
      note: 'from get_schedule',
      tone: 'blue',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
    },
    {
      label: 'Scheduled time',
      value: formatMinutes(booked),
      tone: 'indigo',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      label: 'Open tasks',
      value: String(open.length),
      note: `${data.tasks.length - open.length} completed`,
      tone: 'teal',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      label: 'Next deadline',
      value: next ? dateTimeLabel(next) : 'None',
      ...(next ? { note: open.find((t) => t.deadline === next)?.title ?? '' } : {}),
      tone: 'amber',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      ),
    },
    baseline
      ? {
          label: 'Existing conflicts',
          value: String(baseline.existingConflicts.length),
          note: 'stored schedule, no disruption',
          tone: baseline.existingConflicts.length > 0 ? 'red' : 'green',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ),
        }
      : {
          label: 'Existing conflicts',
          value: 'Unavailable',
          note: data.baselineError ?? 'Analysis did not run',
          tone: 'gray',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          ),
        },
  ];

  return (
    <dl className="summary" aria-label="Day at a glance">
      {stats.map((s) => (
        <div key={s.label} className={`stat stat-${s.tone}`}>
          <div className="stat-top">
            <span className={`stat-icon stat-icon-${s.tone}`} aria-hidden="true">
              {s.icon}
            </span>
            <dt>{s.label}</dt>
          </div>
          <dd className="stat-value">{s.value}</dd>
          {s.note ? <dd className="stat-note muted small">{s.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

