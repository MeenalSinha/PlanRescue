import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initializeDatabase, type Db } from '../apps/mcp-server/src/db/database.js';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';
import { SqliteScheduleRepository } from '../apps/mcp-server/src/data/sqliteScheduleRepository.js';
import { SqliteTaskRepository } from '../apps/mcp-server/src/data/sqliteTaskRepository.js';
import { SqliteRecoveryPlanRepository } from '../apps/mcp-server/src/data/sqliteRecoveryPlanRepository.js';
import { SqliteActionHistoryRepository } from '../apps/mcp-server/src/data/sqliteActionHistoryRepository.js';
import { generateRecoveryPlans } from '../apps/mcp-server/src/recovery/generateRecoveryPlans.js';
import { validateRecoveryPlan } from '../apps/mcp-server/src/recovery/validateRecoveryPlan.js';
import {
  generateRecoveryDecisionReport,
  renderRecoveryDecisionReportMarkdown,
  recoveryDecisionReportSchema,
  REPORT_SCHEMA_VERSION,
} from '../apps/mcp-server/src/recovery/report.js';
import type { RecoveryPlan } from '../apps/mcp-server/src/recovery/types.js';
import type { SavedRecoveryPlan } from '../apps/mcp-server/src/types.js';

describe('Phase 8: Recovery Decision Reports & Explainability', () => {
  let tmp: TempDatabase;
  let db: Db;
  let scheduleRepo: SqliteScheduleRepository;
  let taskRepo: SqliteTaskRepository;
  let planRepo: SqliteRecoveryPlanRepository;
  let historyRepo: SqliteActionHistoryRepository;

  const PLANNING_START = '2026-10-22T08:00:00+05:30';
  const PLANNING_END = '2026-10-22T20:00:00+05:30';
  const DISRUPTED_EVENT_ID = 'evt-001';
  const OVERRUN_MINUTES = 40;

  beforeEach(() => {
    tmp = makeTempDatabase();
    db = initializeDatabase(tmp.path).db;
    scheduleRepo = new SqliteScheduleRepository(db);
    taskRepo = new SqliteTaskRepository(db);
    planRepo = new SqliteRecoveryPlanRepository(db);
    historyRepo = new SqliteActionHistoryRepository(db);
  });

  afterEach(() => {
    try {
      if (db && db.open) {
        db.close();
      }
    } finally {
      try {
        tmp.cleanup();
      } catch {
        // Ignored on Windows if file handle release is asynchronous
      }
    }
  });

  async function getBasePlan(): Promise<RecoveryPlan> {
    const events = await scheduleRepo.findOverlapping({
      startMs: Date.parse(PLANNING_START),
      endMs: Date.parse(PLANNING_END),
    });
    const tasks = await taskRepo.findTasks();
    const planSet = generateRecoveryPlans({
      startTime: PLANNING_START,
      endTime: PLANNING_END,
      events,
      tasks,
      disruption: {
        type: 'event_overrun',
        eventId: DISRUPTED_EVENT_ID,
        overrunMinutes: OVERRUN_MINUTES,
      },
    });
    expect(planSet.outcome).toBe('plans_found');
    expect(planSet.candidates.length).toBeGreaterThan(0);
    return planSet.candidates[0]!;
  }

  // ---------------------------------------------------------------------------
  // 1. Report Schema and Data Tests
  // ---------------------------------------------------------------------------
  describe('1. Report Schema & Data Structure', () => {
    it('generates a valid report matching recoveryDecisionReportSchema', async () => {
      const candidate = await getBasePlan();
      const events = await scheduleRepo.findOverlapping({
        startMs: Date.parse(PLANNING_START),
        endMs: Date.parse(PLANNING_END),
      });
      const tasks = await taskRepo.findTasks();

      const report = generateRecoveryDecisionReport({
        plan: candidate,
        events,
        tasks,
        timeZone: 'Asia/Kolkata',
      });

      const parsed = recoveryDecisionReportSchema.safeParse(report);
      expect(parsed.success).toBe(true);

      // Verify format versioning
      expect(report.metadata.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
      expect(report.metadata.schemaVersion).toBe('1.0.0');

      // Verify metadata fields
      expect(report.metadata.reportId).toBeDefined();
      expect(report.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(report.metadata.timeZone).toBe('Asia/Kolkata');
      expect(report.metadata.limitations.length).toBeGreaterThan(0);

      // Verify disruption
      expect(report.disruption.type).toBe('event_overrun');
      expect(report.disruption.eventId).toBe(DISRUPTED_EVENT_ID);
      expect(report.disruption.overrunMinutes).toBe(OVERRUN_MINUTES);

      // Verify recommended plan structure
      expect(report.recommendedPlan.strategy).toBe(candidate.strategy);
      expect(report.recommendedPlan.rank).toBe(1);
      expect(report.recommendedPlan.changesCount).toBe(candidate.changes.length);

      // Verify deterministic score
      expect(report.decisionRationale.penaltyScore).toBe(candidate.score.total);
      expect(report.decisionRationale.scoringNotice).toContain('Deterministic penalty total (lower is better)');
      expect(report.decisionRationale.scoringNotice).toContain('Not a probability');

      // Verify validation
      expect(report.validation.isValid).toBe(candidate.validation.isValid);
      expect(report.validation.hardViolationsCount).toBe(0);
    });

    it('serializes user-controlled text safely without exposing secrets', async () => {
      const candidate = await getBasePlan();
      // Inject tricky user-controlled content in task/event reason
      const maliciousCandidate: RecoveryPlan = {
        ...candidate,
        changes: [
          {
            ...candidate.changes[0]!,
            title: 'Team Sync | <script>alert("xss")</script> | Evil',
            reason: 'Rescheduling due to pipe | character and \n newline injection',
          },
        ],
      };

      const report = generateRecoveryDecisionReport({ plan: maliciousCandidate });
      const md = renderRecoveryDecisionReportMarkdown(report);

      // Markdown must escape pipes in tables to maintain table structure integrity
      expect(md).toContain('\\|');
      expect(md).not.toContain('API_KEY');
      expect(md).not.toContain('SECRET');
      expect(md).not.toContain('password');
    });

    it('preserves and verifies duration of rescheduled events', async () => {
      const candidate = await getBasePlan();
      const report = generateRecoveryDecisionReport({ plan: candidate });

      for (const change of report.recommendedPlan.changes) {
        expect(change.durationPreserved).toBe(true);
        expect(change.durationMinutes).toBeGreaterThan(0);
        const origDuration =
          (Date.parse(change.originalEndTime) - Date.parse(change.originalStartTime)) / 60_000;
        const propDuration =
          (Date.parse(change.proposedEndTime) - Date.parse(change.proposedStartTime)) / 60_000;
        expect(origDuration).toBe(propDuration);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Markdown Export Tests
  // ---------------------------------------------------------------------------
  describe('2. Markdown Export Format', () => {
    it('renders a comprehensive Markdown report with all required sections', async () => {
      const candidate = await getBasePlan();
      const events = await scheduleRepo.findOverlapping({
        startMs: Date.parse(PLANNING_START),
        endMs: Date.parse(PLANNING_END),
      });

      const report = generateRecoveryDecisionReport({ plan: candidate, events });
      const md = renderRecoveryDecisionReportMarkdown(report);

      // Core headings and structure
      expect(md).toContain('# PlanRescue Recovery Decision Report');
      expect(md).toContain('## Executive Summary');
      expect(md).toContain('## 1. Disruption Context');
      expect(md).toContain('## 2. Rescheduled Events (Schedule Diff)');
      expect(md).toContain('## 3. Protected Commitments (Unchanged Events)');
      expect(md).toContain('## 4. Task Capacity & Deadline Feasibility');
      expect(md).toContain('## 5. Decision Rationale & Deterministic Scoring');
      expect(md).toContain('## 6. Independent Validation & Safety Findings');
      expect(md).toContain('## 7. Audit Trail & Action History');
      expect(md).toContain('## 8. Governance & Scope Notice');

      // Score clarity notice
      expect(md).toContain('Deterministic penalty points; lower is better');
      expect(md).toContain('Not a probability');

      // Schedule diff table headers
      expect(md).toContain('| Event | Original Slot | Proposed Slot | Shift | Duration Preserved | Reason |');

      // Score components table
      expect(md).toContain('| Changed Events |');
      expect(md).toContain('| Priority-Weighted Delay |');
      expect(md).toContain('| Focus Time Disruption |');
      expect(md).toContain('| Tight Transitions |');
      expect(md).toContain('| Task Deadline Risk |');

      // Scope boundaries
      expect(md).toContain('Single-user local prototype with local-user actor attribution');
      expect(md).toContain('Execution targets local PlanRescue SQLite calendar database only');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Lifecycle-State Truthfulness Tests
  // ---------------------------------------------------------------------------
  describe('3. Lifecycle State Truthfulness', () => {
    it('truthfully reports proposed status (unapproved, unapplied)', async () => {
      const candidate = await getBasePlan();
      const saved = await planRepo.savePlan({
        id: randomUUID(),
        requestId: 'req-001',
        sourcePlanId: candidate.planId,
        status: 'proposed',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'hash-abc',
      });

      const report = generateRecoveryDecisionReport({ plan: saved });
      expect(report.metadata.status).toBe('proposed');
      expect(report.recommendedPlan.applied).toBe(false);

      const md = renderRecoveryDecisionReportMarkdown(report);
      expect(md).toContain('`[PROPOSED]`');
      expect(md).toContain('Plan is proposed and awaiting user review. The calendar remains 100% untouched.');
      expect(md).not.toContain('Calendar changes have been atomically written');
    });

    it('truthfully reports approved status without falsely claiming application', async () => {
      const candidate = await getBasePlan();
      const planId = randomUUID();
      await planRepo.savePlan({
        id: planId,
        requestId: 'req-002',
        sourcePlanId: candidate.planId,
        status: 'proposed',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'hash-abc',
      });
      const approved = await planRepo.updatePlanStatus(planId, 'approved', {
        approvedAt: new Date().toISOString(),
      });

      const report = generateRecoveryDecisionReport({ plan: approved });
      expect(report.metadata.status).toBe('approved');
      expect(report.recommendedPlan.applied).toBe(false);

      const md = renderRecoveryDecisionReportMarkdown(report);
      expect(md).toContain('`[APPROVED]`');
      expect(md).toContain('Plan has been approved by the user but NOT yet applied to the calendar.');
      expect(md).not.toContain('Calendar changes have been atomically written');
    });

    it('truthfully reports applied status after atomic execution', async () => {
      const candidate = await getBasePlan();
      const planId = randomUUID();
      await planRepo.savePlan({
        id: planId,
        requestId: 'req-003',
        sourcePlanId: candidate.planId,
        status: 'approved',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'hash-abc',
      });
      const applied = await planRepo.updatePlanStatus(planId, 'applied', {
        appliedAt: new Date().toISOString(),
      });

      const report = generateRecoveryDecisionReport({ plan: applied });
      expect(report.metadata.status).toBe('applied');
      expect(report.recommendedPlan.applied).toBe(true);

      const md = renderRecoveryDecisionReportMarkdown(report);
      expect(md).toContain('`[APPLIED]`');
      expect(md).toContain('Calendar changes have been atomically written to the SQLite database.');
    });

    it('truthfully reports rejected status and prevents misleading presentation', async () => {
      const candidate = await getBasePlan();
      const planId = randomUUID();
      await planRepo.savePlan({
        id: planId,
        requestId: 'req-004',
        sourcePlanId: candidate.planId,
        status: 'proposed',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'hash-abc',
      });
      const rejected = await planRepo.updatePlanStatus(planId, 'rejected', {
        rejectedAt: new Date().toISOString(),
      });

      const report = generateRecoveryDecisionReport({ plan: rejected });
      expect(report.metadata.status).toBe('rejected');
      expect(report.recommendedPlan.applied).toBe(false);

      const md = renderRecoveryDecisionReportMarkdown(report);
      expect(md).toContain('`[REJECTED]`');
      expect(md).toContain('Plan was rejected and cannot be applied.');
    });

    it('truthfully reports stale status when schedule changed', async () => {
      const candidate = await getBasePlan();
      const planId = randomUUID();
      await planRepo.savePlan({
        id: planId,
        requestId: 'req-005',
        sourcePlanId: candidate.planId,
        status: 'proposed',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'hash-abc',
      });
      const stale = await planRepo.updatePlanStatus(planId, 'stale');

      const report = generateRecoveryDecisionReport({ plan: stale });
      expect(report.metadata.status).toBe('stale');
      expect(report.recommendedPlan.applied).toBe(false);

      const md = renderRecoveryDecisionReportMarkdown(report);
      expect(md).toContain('`[STALE]`');
      expect(md).toContain('This plan is stale and CANNOT be applied without regenerating.');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Read-Only Safety Tests
  // ---------------------------------------------------------------------------
  describe('4. Read-Only Safety Guarantees', () => {
    it('generating or exporting reports causes zero mutations to SQLite database', async () => {
      const candidate = await getBasePlan();
      const planId = randomUUID();
      const saved = await planRepo.savePlan({
        id: planId,
        requestId: 'req-readonly-001',
        sourcePlanId: candidate.planId,
        status: 'proposed',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'hash-readonly',
      });

      // Record baseline database state
      const initialEvents = db.prepare('SELECT * FROM calendar_events ORDER BY id').all();
      const initialPlans = db.prepare('SELECT * FROM recovery_plans ORDER BY id').all();
      const initialActions = db.prepare('SELECT * FROM action_history ORDER BY id').all();
      const initialTasks = db.prepare('SELECT * FROM tasks ORDER BY id').all();

      // Perform repeated report generations and exports
      const report1 = generateRecoveryDecisionReport({ plan: saved });
      const md1 = renderRecoveryDecisionReportMarkdown(report1);
      const json1 = JSON.stringify(report1);

      const report2 = generateRecoveryDecisionReport({ plan: candidate });
      const md2 = renderRecoveryDecisionReportMarkdown(report2);
      const json2 = JSON.stringify(report2);

      expect(md1.length).toBeGreaterThan(0);
      expect(json1.length).toBeGreaterThan(0);
      expect(md2.length).toBeGreaterThan(0);
      expect(json2.length).toBeGreaterThan(0);

      // Verify database state is 100% identical byte-for-byte
      const postEvents = db.prepare('SELECT * FROM calendar_events ORDER BY id').all();
      const postPlans = db.prepare('SELECT * FROM recovery_plans ORDER BY id').all();
      const postActions = db.prepare('SELECT * FROM action_history ORDER BY id').all();
      const postTasks = db.prepare('SELECT * FROM tasks ORDER BY id').all();

      expect(postEvents).toEqual(initialEvents);
      expect(postPlans).toEqual(initialPlans);
      expect(postActions).toEqual(initialActions);
      expect(postTasks).toEqual(initialTasks);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Integration Workflow Test
  // ---------------------------------------------------------------------------
  describe('5. Full End-to-End Report Integration Workflow', () => {
    it('executes full 12-step recovery report lifecycle against persistent SQLite', async () => {
      // Step 1: Retrieve current schedule and tasks
      const events = await scheduleRepo.findOverlapping({
        startMs: Date.parse(PLANNING_START),
        endMs: Date.parse(PLANNING_END),
      });
      const tasks = await taskRepo.findTasks();
      expect(events.length).toBeGreaterThan(0);
      expect(tasks.length).toBeGreaterThan(0);

      // Step 2-4: Submit event_overrun, analyze, generate recovery candidates
      const planSet = generateRecoveryPlans({
        startTime: PLANNING_START,
        endTime: PLANNING_END,
        events,
        tasks,
        disruption: {
          type: 'event_overrun',
          eventId: DISRUPTED_EVENT_ID,
          overrunMinutes: OVERRUN_MINUTES,
        },
      });
      expect(planSet.candidates.length).toBeGreaterThan(0);
      const candidate = planSet.candidates[0]!;

      // Step 5: Independently validate candidate
      const validation = validateRecoveryPlan(candidate, { events, tasks });
      expect(validation.isValid).toBe(true);

      // Step 6: Persist candidate
      const planId = randomUUID();
      const savedPlan = await planRepo.savePlan({
        id: planId,
        requestId: 'req-e2e-801',
        sourcePlanId: candidate.planId,
        status: 'proposed',
        planJson: JSON.stringify(candidate),
        planningStart: candidate.startTime,
        planningEnd: candidate.endTime,
        snapshotHash: 'snap-hash-801',
      });
      await historyRepo.recordAction({
        id: randomUUID(),
        recoveryPlanId: planId,
        actionType: 'plan_saved',
        actor: 'local-user',
        detailsJson: JSON.stringify({ requestId: 'req-e2e-801', status: 'proposed' }),
      });

      // Step 7: Retrieve saved plan and action history
      const retrieved = await planRepo.getPlan(planId);
      expect(retrieved).not.toBeNull();
      const history = await historyRepo.findActions({ recoveryPlanId: planId });
      expect(history.length).toBe(1);

      // Step 8: Open saved plan's report
      const report = generateRecoveryDecisionReport({
        plan: retrieved!,
        actionHistory: history,
        events,
        tasks,
      });

      // Step 9: Export report as Markdown
      const markdownExport = renderRecoveryDecisionReportMarkdown(report);
      expect(markdownExport).toContain(planId);
      expect(markdownExport).toContain('req-e2e-801');
      expect(markdownExport).toContain('plan_saved');

      // Step 10: Export report as JSON
      const jsonExport = JSON.stringify(report, null, 2);
      const parsedJson = JSON.parse(jsonExport);
      expect(recoveryDecisionReportSchema.safeParse(parsedJson).success).toBe(true);

      // Step 11: Verify exports agree with persisted plan and action history
      expect(report.metadata.planId).toBe(planId);
      expect(report.metadata.requestId).toBe('req-e2e-801');
      expect(report.auditTrail.length).toBe(1);
      expect(report.auditTrail[0]!.actionType).toBe('plan_saved');
      expect(report.recommendedPlan.changesCount).toBe(candidate.changes.length);

      // Step 12: Verify reporting did not mutate schedule or plan lifecycle state
      const planAfterReport = await planRepo.getPlan(planId);
      expect(planAfterReport!.status).toBe('proposed');
      const eventsAfterReport = await scheduleRepo.findOverlapping({
        startMs: Date.parse(PLANNING_START),
        endMs: Date.parse(PLANNING_END),
      });
      expect(eventsAfterReport).toEqual(events);
    });
  });
});
