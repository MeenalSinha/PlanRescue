'use client';

import { useState } from 'react';
import { longDate } from '@/lib/time';
import { useRecoveryApp } from '@/lib/useRecoveryApp';
import { ActionHistoryPanel } from './ActionHistoryPanel';
import { ActivityPanel, ConnectionBadge } from './ActivityPanel';
import { AgentChat } from './AgentChat';
import { AnalysisPanel } from './AnalysisPanel';
import { DisruptionForm } from './DisruptionForm';
import { PlanComparison } from './PlanComparison';
import { Timeline, computeRange, type TimelineItem } from './ScheduleTimeline';
import { SummaryStrip } from './SummaryStrip';
import { TaskList } from './TaskList';
import { Notice, SectionCard, Spinner } from './ui';
import { rangeLabel } from '@/lib/time';
import type { DashboardData } from '@/lib/api';

type View = 'plan' | 'activity' | 'history';

function dayItems(data: DashboardData): TimelineItem[] {
  return data.events.map((e) => ({
    id: e.id,
    title: e.title,
    startMs: Date.parse(e.startTime),
    endMs: Date.parse(e.endTime),
    timeLabel: rangeLabel(e.startTime, e.endTime),
    tone: e.movable ? 'movable' : 'fixed',
    priority: e.priority,
    tags: [],
  }));
}

export function App() {
  const app = useRecoveryApp();
  const [view, setView] = useState<View>('plan');
  const { dashboard, lastData } = app;
  const data = dashboard.status === 'ready' ? dashboard.data : lastData;
  const loading = dashboard.status === 'loading';

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            P
          </span>
          <div>
            <p className="brand-name">PlanRescue</p>
            <p className="brand-tag">Your day changed. Your assistant has a plan.</p>
          </div>
        </div>
        <nav aria-label="Primary">
          <ul className="nav">
            <li>
              <button type="button" className="nav-btn" aria-current={view === 'plan' ? 'page' : undefined} onClick={() => setView('plan')}>
                Today’s Plan
              </button>
            </li>
            <li>
              <button type="button" className="nav-btn" aria-current={view === 'history' ? 'page' : undefined} onClick={() => {
                setView('history');
                void app.loadActionHistory();
              }}>
                History
              </button>
            </li>
            <li>
              <button type="button" className="nav-btn" aria-current={view === 'activity' ? 'page' : undefined} onClick={() => setView('activity')}>
                Activity
              </button>
            </li>
          </ul>
        </nav>
        <div className="topbar-status">
          <ConnectionBadge connection={app.connection} />
          <span className="badge badge-sample" title="Seeded development data, not a real calendar">
            Sample development data
          </span>
        </div>
      </header>

      <div className="layout">
        <main id="main" className="workspace" tabIndex={-1}>
          {view === 'activity' ? (
            <SectionCard title="Activity" subtitle="Every MCP tool call the web server made for you in this session.">
              <ActivityPanel log={app.log} pending={app.pending} connection={app.connection} full />
            </SectionCard>
          ) : view === 'history' ? (
            <SectionCard title="Audit Trail" subtitle="Persistent action history recorded in SQLite across all sessions.">
              <ActionHistoryPanel history={app.actionHistory} onRefresh={() => void app.loadActionHistory()} />
            </SectionCard>
          ) : (
            <>
              <div className="toolbar">
                <div>
                  <h1>Today’s Plan</h1>
                  <p className="muted small">
                    {data ? (
                      <>
                        {longDate(data.date)} · {data.calendarTimeZone} (UTC{data.utcOffset})
                      </>
                    ) : (
                      longDate(app.date)
                    )}
                  </p>
                </div>
                <div className="toolbar-controls">
                  <label className="inline-field">
                    <span>Date</span>
                    <input type="date" value={app.date} onChange={(e) => e.target.value && app.changeDate(e.target.value)} />
                  </label>
                  <button type="button" className="btn btn-secondary" onClick={() => void app.refresh()} disabled={loading}>
                    {loading ? <Spinner label="Refreshing…" /> : 'Refresh'}
                  </button>
                </div>
              </div>

              <p className="readonly-note">
                Read-only preview: PlanRescue analyzes and proposes. <strong>Your stored calendar is never changed</strong> by anything on this page.
              </p>

              {dashboard.status === 'error' ? (
                <Notice
                  tone="danger"
                  live="assertive"
                  title={dashboard.error.code === 'mcp_unavailable' || dashboard.error.code === 'mcp_timeout' ? 'Can’t reach the PlanRescue MCP server' : 'Couldn’t load your schedule'}
                  action={
                    <button type="button" className="btn btn-primary" onClick={() => void app.refresh()}>
                      Retry
                    </button>
                  }
                >
                  <p>{dashboard.error.message}</p>
                  {dashboard.error.code === 'mcp_unavailable' || dashboard.error.code === 'mcp_timeout' ? (
                    <p>
                      Start the backend in another terminal with <code>npm run dev:mcp</code>, then retry. Your form choices are kept.
                    </p>
                  ) : null}
                  {data ? <p>Showing the last data that loaded successfully; it may be out of date.</p> : null}
                </Notice>
              ) : null}

              {loading && !data ? (
                <div className="card skeleton" aria-busy="true">
                  <Spinner label="Loading your schedule and tasks from the MCP server…" />
                </div>
              ) : null}

              {data ? (
                <>
                  <SummaryStrip data={data} />

                  <div className="two-col">
                    <SectionCard title="Schedule" id="schedule" subtitle={`${data.events.length} event${data.events.length === 1 ? '' : 's'} · get_schedule`}>
                      {data.events.length === 0 ? (
                        <p className="empty">No events are scheduled for this day.</p>
                      ) : (
                        <Timeline items={dayItems(data)} range={computeRange(dayItems(data), data.utcOffset)} label="Schedule for the day" />
                      )}
                    </SectionCard>
                    <SectionCard title="Tasks and deadlines" id="tasks" subtitle={`${data.tasks.length} due in the next 7 days · get_tasks`}>
                      {data.tasks.length === 0 ? <p className="empty">No tasks are due in this period.</p> : <TaskList tasks={data.tasks} />}
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="1 · Report a disruption"
                    id="scenario"
                    subtitle="Natural language AI agent or structured manual controls"
                  >
                    <AgentChat
                      history={app.chatHistory}
                      turn={app.agentTurn}
                      busy={app.agentTurn.status === 'loading'}
                      onSend={(msg) => void app.sendAgentMessage(msg)}
                      onSwitchToStructured={() => {
                        const el = document.getElementById('manual-controls');
                        el?.scrollIntoView({ behavior: 'smooth' });
                      }}
                    />

                    <div className="section-divider" id="manual-controls">
                      <span className="section-divider-text">Or configure manually with structured controls</span>
                    </div>

                    <DisruptionForm
                      dashboard={data}
                      form={app.form}
                      errors={app.formErrors}
                      busy={app.analysis.status === 'loading'}
                      onChange={app.setForm}
                      onSubmit={() => void app.analyze()}
                    />
                  </SectionCard>

                  {app.analysis.status !== 'idle' ? (
                    <SectionCard title="2 · Conflict analysis" id="analysis" subtitle="analyze_conflicts · hypothetical, nothing is saved">
                      {app.analysis.status === 'loading' ? <Spinner label="Analyzing the disruption…" /> : null}
                      {app.analysis.status === 'error' ? (
                        <Notice
                          tone="danger"
                          live="assertive"
                          title="The analysis could not be completed"
                          action={
                            <button type="button" className="btn btn-small" onClick={() => void app.analyze()}>
                              Try again
                            </button>
                          }
                        >
                          {app.analysis.error.message}
                        </Notice>
                      ) : null}
                      {app.analysis.status === 'ready' ? (
                        <AnalysisPanel
                          analysis={app.analysis.data}
                          events={data.events}
                          stale={app.scenarioChanged}
                          generating={app.proposal.status === 'loading'}
                          hasProposal={app.proposal.status === 'ready'}
                          onGenerate={() => void app.generatePlans()}
                        />
                      ) : null}
                    </SectionCard>
                  ) : null}

                  {app.proposal.status !== 'idle' ? (
                    <SectionCard title="3 · Recovery plans" id="plans" subtitle="propose_recovery_plan · independently validated candidates">
                      {app.proposal.status === 'loading' ? <Spinner label="Generating recovery plans…" /> : null}
                      {app.proposal.status === 'error' ? (
                        <Notice
                          tone="danger"
                          live="assertive"
                          title="Recovery plans could not be generated"
                          action={
                            <button type="button" className="btn btn-small" onClick={() => void app.generatePlans()}>
                              Try again
                            </button>
                          }
                        >
                          {app.proposal.error.message}
                        </Notice>
                      ) : null}
                      {app.proposal.status === 'ready' ? (
                        <PlanComparison
                          proposal={app.proposal.data}
                          events={data.events}
                          tasks={data.tasks}
                          utcOffset={data.utcOffset}
                          selectedPlanId={app.selectedPlanId}
                          validations={app.validations}
                          executingPlanId={app.executingPlanId}
                          onSelect={app.setSelectedPlanId}
                          onVerify={(plan) => void app.verifyPlan(plan)}
                          onApprove={app.approvePlan}
                          onReject={app.rejectPlan}
                          onApply={app.applyPlan}
                        />
                      ) : null}
                    </SectionCard>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </main>

        {view === 'plan' ? (
          <div className="side">
            <ActivityPanel log={app.log} pending={app.pending} connection={app.connection} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
