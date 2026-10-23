import { useId } from 'react';
import type { DashboardData } from '@/lib/api';
import { MAX_OVERRUN_MINUTES, OVERRUN_PRESETS } from '@/lib/requests';
import { clock, longDate } from '@/lib/time';
import type { ScenarioForm } from '@/lib/useRecoveryApp';
import { Spinner } from './ui';

interface Props {
  dashboard: DashboardData;
  form: ScenarioForm;
  errors: Record<string, string>;
  busy: boolean;
  onChange(patch: Partial<ScenarioForm>): void;
  onSubmit(): void;
}

export function DisruptionForm({ dashboard, form, errors, busy, onChange, onSubmit }: Props) {
  const uid = useId();
  const id = (name: string): string => `${uid}-${name}`;
  const err = (key: string): string | undefined => errors[key];
  const describe = (key: string, extra?: string): string | undefined => [err(key) ? id(`${key}-err`) : undefined, extra].filter(Boolean).join(' ') || undefined;
  const events = dashboard.events;
  const protectable = events.filter((e) => e.id !== form.eventId);
  const hasEvents = events.length > 0;

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      aria-describedby={id('intro')}
    >
      <p id={id('intro')} className="muted small">
        Describe what changed. This is a hypothetical: nothing you enter here is saved to the calendar. Times are {dashboard.calendarTimeZone} (UTC{dashboard.utcOffset}).
      </p>

      <fieldset className="field-group">
        <legend>Planning window</legend>
        <div className="row">
          <div className="field">
            <label htmlFor={id('start')}>Window starts</label>
            <input id={id('start')} type="datetime-local" value={form.startLocal} aria-invalid={err('startTime') ? true : undefined} aria-describedby={describe('startTime')} onChange={(e) => onChange({ startLocal: e.target.value })} />
            {err('startTime') ? (
              <p id={id('startTime-err')} className="field-error">
                {err('startTime')}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor={id('end')}>Window ends</label>
            <input id={id('end')} type="datetime-local" value={form.endLocal} aria-invalid={err('endTime') ? true : undefined} aria-describedby={describe('endTime')} onChange={(e) => onChange({ endLocal: e.target.value })} />
            {err('endTime') ? (
              <p id={id('endTime-err')} className="field-error">
                {err('endTime')}
              </p>
            ) : null}
          </div>
        </div>
        <p className="hint">Rescheduled events must stay inside this window. The start also counts as “now” when task capacity is estimated.</p>
      </fieldset>

      <div className="field">
        <label htmlFor={id('type')}>Disruption type</label>
        <select id={id('type')} value="event_overrun" disabled aria-describedby={id('type-hint')}>
          <option value="event_overrun">Event ran late (overrun)</option>
        </select>
        <p id={id('type-hint')} className="hint">
          Event overruns are the only disruption the Recovery Engine supports in this version.
        </p>
      </div>

      <div className="field">
        <label htmlFor={id('event')}>Event that ran late</label>
        <select
          id={id('event')}
          value={form.eventId}
          disabled={!hasEvents}
          aria-invalid={err('disruption.eventId') ? true : undefined}
          aria-describedby={describe('disruption.eventId')}
          onChange={(e) => onChange({ eventId: e.target.value })}
        >
          <option value="">{hasEvents ? 'Choose an event…' : 'No events available'}</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} ({clock(e.startTime)} – {clock(e.endTime)})
            </option>
          ))}
        </select>
        {err('disruption.eventId') ? (
          <p id={id('disruption.eventId-err')} className="field-error">
            {err('disruption.eventId')}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor={id('overrun')}>Minutes late</label>
        <div className="presets" role="group" aria-label="Common delays">
          {OVERRUN_PRESETS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={form.overrun.trim() === String(m)} onClick={() => onChange({ overrun: String(m) })}>
              {m} min
            </button>
          ))}
        </div>
        <input
          id={id('overrun')}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_OVERRUN_MINUTES}
          step={1}
          value={form.overrun}
          aria-invalid={err('disruption.overrunMinutes') ? true : undefined}
          aria-describedby={describe('disruption.overrunMinutes', id('overrun-hint'))}
          onChange={(e) => onChange({ overrun: e.target.value })}
        />
        <p id={id('overrun-hint')} className="hint">
          A whole number from 1 to {MAX_OVERRUN_MINUTES}.
        </p>
        {err('disruption.overrunMinutes') ? (
          <p id={id('disruption.overrunMinutes-err')} className="field-error">
            {err('disruption.overrunMinutes')}
          </p>
        ) : null}
      </div>

      <fieldset className="field-group">
        <legend>Events that must not move</legend>
        <p className="hint">
          Tick anything you want kept exactly where it is. The Recovery Engine already refuses to move immovable and critical-priority events, so these choices are additional protection.
        </p>
        {protectable.length === 0 ? (
          <p className="muted small">No other events to protect.</p>
        ) : (
          <ul className="checklist">
            {protectable.map((e) => {
              const checked = form.protectedIds.includes(e.id);
              return (
                <li key={e.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onChange({ protectedIds: checked ? form.protectedIds.filter((x) => x !== e.id) : [...form.protectedIds, e.id] })}
                    />
                    <span>
                      {e.title}
                      <span className="muted small">
                        {' '}
                        · {clock(e.startTime)} – {clock(e.endTime)}
                        {!e.movable || e.priority === 'critical' ? ' · already protected by the engine' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor={id('prefer')}>Rank plans by</label>
        <select id={id('prefer')} value={form.optimizeFor} onChange={(e) => onChange({ optimizeFor: e.target.value as ScenarioForm['optimizeFor'] })}>
          <option value="minimal_disruption">Minimal disruption (default)</option>
          <option value="transition_time">Breathing room between events</option>
        </select>
        <p className="hint">Changes the order of the candidates only. It never relaxes a hard rule.</p>
      </div>

      {Object.keys(errors).length > 0 && !errors['disruption.eventId'] && !errors['disruption.overrunMinutes'] && !errors['startTime'] && !errors['endTime'] ? (
        <p className="field-error" role="alert">
          {Object.values(errors)[0]}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !hasEvents}>
          {busy ? <Spinner label="Analyzing…" /> : 'Analyze disruption'}
        </button>
        <span className="muted small">Planning for {longDate(dashboard.date)}</span>
      </div>
    </form>
  );
}
