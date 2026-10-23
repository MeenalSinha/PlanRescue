import type { DashboardData } from '@/lib/api';
import { dateTimeLabel, formatMinutes } from '@/lib/time';

export function SummaryStrip({ data }: { data: DashboardData }) {
  const booked = data.events.reduce((sum, e) => sum + e.durationMinutes, 0);
  const open = data.tasks.filter((t) => t.status !== 'completed');
  const next = open.map((t) => t.deadline).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const baseline = data.baseline?.analysis;

  const stats: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Events today', value: String(data.events.length), note: 'from get_schedule' },
    { label: 'Scheduled time', value: formatMinutes(booked) },
    { label: 'Open tasks', value: String(open.length), note: `${data.tasks.length - open.length} completed` },
    { label: 'Next deadline', value: next ? dateTimeLabel(next) : 'None', ...(next ? { note: open.find((t) => t.deadline === next)?.title ?? '' } : {}) },
    baseline
      ? { label: 'Existing conflicts', value: String(baseline.existingConflicts.length), note: 'stored schedule, no disruption' }
      : { label: 'Existing conflicts', value: 'Unavailable', note: data.baselineError ?? 'Analysis did not run' },
  ];

  return (
    <dl className="summary" aria-label="Day at a glance">
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <dt>{s.label}</dt>
          <dd className="stat-value">{s.value}</dd>
          {s.note ? <dd className="stat-note muted small">{s.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
