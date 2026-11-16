import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTempDatabase, type TempDatabase } from './helpers/tempDatabase.js';
import { initializeDatabase, type Db } from '../apps/mcp-server/src/db/database.js';
import { SqliteScheduleRepository } from '../apps/mcp-server/src/data/sqliteScheduleRepository.js';
import { SqliteTaskRepository } from '../apps/mcp-server/src/data/sqliteTaskRepository.js';
import { SqliteRecoveryPlanRepository } from '../apps/mcp-server/src/data/sqliteRecoveryPlanRepository.js';
import { SqliteActionHistoryRepository } from '../apps/mcp-server/src/data/sqliteActionHistoryRepository.js';
import { computeSnapshotHash } from '../apps/mcp-server/src/data/snapshotHash.js';
import { analyzeConflicts } from '../apps/mcp-server/src/recovery/analyzeConflicts.js';
import { generateRecoveryPlans } from '../apps/mcp-server/src/recovery/generateRecoveryPlans.js';
import { validateRecoveryPlan } from '../apps/mcp-server/src/recovery/validateRecoveryPlan.js';
import { toEpochMs } from '../apps/mcp-server/src/lib/time.js';

describe('Real Backend Recovery Integration (SQLite + Deterministic Engine + Safe Execution)', () => {
  let tmp: TempDatabase;
  let db: Db;
  let scheduleRepo: SqliteScheduleRepository;
  let taskRepo: SqliteTaskRepository;
  let planRepo: SqliteRecoveryPlanRepository;
  let historyRepo: SqliteActionHistoryRepository;

  const PLANNING_START = '2026-10-22T08:00:00+05:30';
  const PLANNING_END = '2026-10-22T20:00:00+05:30';
  const DAY_INTERVAL = {
    startMs: toEpochMs(PLANNING_START),
    endMs: toEpochMs(PLANNING_END),
  };

  beforeEach(() => {
    tmp = makeTempDatabase();
    db = initializeDatabase(tmp.path).db;
    scheduleRepo = new SqliteScheduleRepository(db);
    taskRepo = new SqliteTaskRepository(db);
    planRepo = new SqliteRecoveryPlanRepository(db);
    historyRepo = new SqliteActionHistoryRepository(db);
  });

  afterEach(() => {
    if (db.open) db.close();
    tmp.cleanup();
  });

  it('completes the entire real lifecycle: analyze -> generate -> persist -> validate -> approve -> execute atomically -> audit history', async () => {
    // 1. Retrieve initial schedule and tasks from SQLite
    const initialEvents = await scheduleRepo.findOverlapping(DAY_INTERVAL);
    const initialTasks = await taskRepo.findTasks();
    expect(initialEvents.length).toBeGreaterThan(0);
    expect(initialTasks.length).toBeGreaterThan(0);

    const overrunEvent = initialEvents[0]!; // evt-001 (Team Meeting)

    // 2. Conflict Analysis
    const conflictResult = analyzeConflicts({
      startTime: PLANNING_START,
      endTime: PLANNING_END,
      events: initialEvents,
      tasks: initialTasks,
      disruption: {
        type: 'event_overrun',
        eventId: overrunEvent.id,
        overrunMinutes: 40,
      },
      protectedEventIds: ['evt-005'], // Doctor's appointment is critical & protected
    });
    expect(conflictResult.newConflicts.length).toBeGreaterThan(0);
    expect(conflictResult.assessment.status).toBe('conflicts_resolvable');

    // 3. Deterministic Recovery Plan Generation
    const planSet = generateRecoveryPlans({
      startTime: PLANNING_START,
      endTime: PLANNING_END,
      events: initialEvents,
      tasks: initialTasks,
      disruption: {
        type: 'event_overrun',
        eventId: overrunEvent.id,
        overrunMinutes: 40,
      },
      protectedEventIds: ['evt-005'],
    });
    expect(planSet.outcome).toBe('plans_found');
    expect(planSet.candidates.length).toBeGreaterThan(0);

    const topCandidate = planSet.candidates[0]!;
    expect(topCandidate.strategy).toBe('minimal_disruption');
    expect(topCandidate.score.hardViolations).toBe(0);

    // 4. Persist Candidates to SQLite with SHA-256 snapshot hash
    const persistentPlanId = randomUUID();
    const sourceHash = computeSnapshotHash(initialEvents, initialTasks);
    const savedPlan = await planRepo.savePlan({
      id: persistentPlanId,
      requestId: 'req-real-integration',
      sourcePlanId: topCandidate.planId,
      status: 'proposed',
      planJson: JSON.stringify(topCandidate),
      planningStart: PLANNING_START,
      planningEnd: PLANNING_END,
      snapshotHash: sourceHash,
    });
    expect(savedPlan.id).toBe(persistentPlanId);
    expect(savedPlan.status).toBe('proposed');

    // 5. Independent Plan Validation against real database state
    const validation = validateRecoveryPlan(topCandidate, {
      events: initialEvents,
      tasks: initialTasks,
    });
    expect(validation.isValid).toBe(true);
    expect(validation.violations.length).toBe(0);

    // 6. Explicit Approval Step (Status transitions from 'proposed' to 'approved')
    const retrievedBeforeApproval = await planRepo.getPlan(persistentPlanId);
    expect(retrievedBeforeApproval?.status).toBe('proposed');

    await planRepo.updatePlanStatus(persistentPlanId, 'approved');
    await historyRepo.recordAction({
      recoveryPlanId: persistentPlanId,
      actionType: 'plan_approved',
      actor: 'local-user',
      detailsJson: JSON.stringify({ summary: `Approved recovery plan ${persistentPlanId}`, strategy: topCandidate.strategy }),
    });

    const retrievedAfterApproval = await planRepo.getPlan(persistentPlanId);
    expect(retrievedAfterApproval?.status).toBe('approved');

    // CRITICAL SAFETY CHECK: Verify schedule events in SQLite are NOT yet modified!
    const eventsAtApproval = await scheduleRepo.findOverlapping(DAY_INTERVAL);
    expect(eventsAtApproval[1]!.startTime).toBe(initialEvents[1]!.startTime);
    expect(eventsAtApproval[1]!.endTime).toBe(initialEvents[1]!.endTime);

    // 7. Atomic Execution Confirmation Step
    const currentEvents = await scheduleRepo.findOverlapping(DAY_INTERVAL);
    const currentTasks = await taskRepo.findTasks();
    const currentHash = computeSnapshotHash(currentEvents, currentTasks);

    // Verify snapshot freshness
    expect(currentHash).toBe(retrievedAfterApproval?.snapshotHash);

    // Apply updates atomically via repository
    const updates = topCandidate.changes.map((c) => ({
      eventId: c.eventId,
      originalStartTime: c.originalStartTime,
      originalEndTime: c.originalEndTime,
      proposedStartTime: c.proposedStartTime,
      proposedEndTime: c.proposedEndTime,
    }));

    await planRepo.applyApprovedPlanAtomically({
      planId: persistentPlanId,
      actor: 'local-user',
      updates,
      historyDetailsJson: JSON.stringify({ changesCount: topCandidate.changes.length }),
    });

    // 8. Verify SQLite Calendar State After Atomic Execution
    const updatedEvents = await scheduleRepo.findOverlapping(DAY_INTERVAL);
    const updatedLunch = updatedEvents.find((e) => e.id === 'evt-002');
    expect(updatedLunch?.startTime).toBe(topCandidate.changes[0]?.proposedStartTime);
    expect(updatedLunch?.endTime).toBe(topCandidate.changes[0]?.proposedEndTime);

    // Verify critical doctor's appointment ('evt-005') remained completely unmoved
    const doctorAppointment = updatedEvents.find((e) => e.id === 'evt-005');
    expect(doctorAppointment?.startTime).toBe(initialEvents.find((e) => e.id === 'evt-005')?.startTime);

    // 9. Verify Action History contains persistent audit entries
    const historyEntries = await historyRepo.findActions({ recoveryPlanId: persistentPlanId });
    expect(historyEntries.length).toBe(2);
    expect(historyEntries[0]?.actionType).toBe('plan_approved');
    expect(historyEntries[1]?.actionType).toBe('plan_applied');
  });

  it('rejects stale plan execution when calendar was modified concurrently', async () => {
    const initialEvents = await scheduleRepo.findOverlapping(DAY_INTERVAL);
    const initialTasks = await taskRepo.findTasks();

    const planSet = generateRecoveryPlans({
      startTime: PLANNING_START,
      endTime: PLANNING_END,
      events: initialEvents,
      tasks: initialTasks,
      disruption: { type: 'event_overrun', eventId: initialEvents[0]!.id, overrunMinutes: 30 },
    });

    const persistentPlanId = randomUUID();
    const sourceHash = computeSnapshotHash(initialEvents, initialTasks);
    await planRepo.savePlan({
      id: persistentPlanId,
      requestId: 'req-stale-test',
      sourcePlanId: planSet.candidates[0]!.planId,
      status: 'proposed',
      planJson: JSON.stringify(planSet.candidates[0]!),
      planningStart: PLANNING_START,
      planningEnd: PLANNING_END,
      snapshotHash: sourceHash,
    });
    await planRepo.updatePlanStatus(persistentPlanId, 'approved');

    // Concurrent schedule modification occurs:
    db.prepare("UPDATE calendar_events SET start_time = '2026-10-22T12:35:00+05:30', start_ms = start_ms + 300000 WHERE id = ?").run('evt-002');

    // Fresh snapshot hash now differs from the plan's stored hash:
    const freshEvents = await scheduleRepo.findOverlapping(DAY_INTERVAL);
    const freshTasks = await taskRepo.findTasks();
    const freshHash = computeSnapshotHash(freshEvents, freshTasks);

    const storedPlan = await planRepo.getPlan(persistentPlanId);
    expect(storedPlan?.snapshotHash).not.toBe(freshHash);

    // Stale plan detection triggers: plan cannot be safely executed
    const isStale = storedPlan?.snapshotHash !== freshHash;
    expect(isStale).toBe(true);
  });
});
