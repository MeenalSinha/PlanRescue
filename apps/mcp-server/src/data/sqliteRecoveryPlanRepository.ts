import type Database from 'better-sqlite3';
import {
  type RecoveryPlanRepository,
  type SavedRecoveryPlan,
  type NewRecoveryPlan,
  type RecoveryPlanQuery,
  type RecoveryPlanStatus,
} from '../types.js';

interface RecoveryPlanRow {
  id: string;
  request_id: string;
  source_plan_id: string;
  status: string;
  plan_json: string;
  planning_start: string;
  planning_end: string;
  snapshot_hash: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  applied_at: string | null;
}

export class SqliteRecoveryPlanRepository implements RecoveryPlanRepository {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
  }

  public async savePlan(plan: NewRecoveryPlan): Promise<SavedRecoveryPlan> {
    const existing = this.db
      .prepare<[string, string], RecoveryPlanRow>(
        'SELECT * FROM recovery_plans WHERE request_id = ? AND source_plan_id = ?',
      )
      .get(plan.requestId, plan.sourcePlanId);

    if (existing) {
      return this.rowToPlan(existing);
    }

    const now = new Date().toISOString();
    const insertStmt = this.db.prepare(`
      INSERT INTO recovery_plans (
        id,
        request_id,
        source_plan_id,
        status,
        plan_json,
        planning_start,
        planning_end,
        snapshot_hash,
        created_at,
        updated_at,
        approved_at,
        rejected_at,
        applied_at
      ) VALUES (
        @id,
        @requestId,
        @sourcePlanId,
        @status,
        @planJson,
        @planningStart,
        @planningEnd,
        @snapshotHash,
        @createdAt,
        @updatedAt,
        NULL,
        NULL,
        NULL
      )
      RETURNING *
    `);

    const row = insertStmt.get({
      id: plan.id,
      requestId: plan.requestId,
      sourcePlanId: plan.sourcePlanId,
      status: plan.status,
      planJson: plan.planJson,
      planningStart: plan.planningStart,
      planningEnd: plan.planningEnd,
      snapshotHash: plan.snapshotHash,
      createdAt: now,
      updatedAt: now,
    }) as RecoveryPlanRow;

    return this.rowToPlan(row);
  }

  public async getPlan(id: string): Promise<SavedRecoveryPlan | null> {
    const stmt = this.db.prepare<[string], RecoveryPlanRow>(`
      SELECT * FROM recovery_plans WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? this.rowToPlan(row) : null;
  }

  public async findPlans(query: RecoveryPlanQuery = {}): Promise<SavedRecoveryPlan[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.planId) {
      conditions.push('id = ?');
      params.push(query.planId);
    }

    if (query.requestId) {
      conditions.push('request_id = ?');
      params.push(query.requestId);
    }

    if (query.status) {
      conditions.push('status = ?');
      params.push(query.status);
    }

    let sql = 'SELECT * FROM recovery_plans';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY updated_at DESC, created_at DESC';

    if (query.limit && query.limit > 0) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as RecoveryPlanRow[];
    return rows.map((r) => this.rowToPlan(r));
  }

  public async updatePlanStatus(
    id: string,
    toStatus: RecoveryPlanStatus,
    options?: {
      expectedStatus?: RecoveryPlanStatus | RecoveryPlanStatus[];
      approvedAt?: string;
      rejectedAt?: string;
      appliedAt?: string;
    },
  ): Promise<SavedRecoveryPlan> {
    const now = new Date().toISOString();
    const whereConditions = ['id = ?'];
    const whereParams: (string | number)[] = [id];

    let sql = 'UPDATE recovery_plans SET status = ?, updated_at = ?';
    const setParams: (string | number)[] = [toStatus, now];

    if (options?.approvedAt) {
      sql += ', approved_at = ?';
      setParams.push(options.approvedAt);
    } else if (toStatus === 'approved') {
      sql += ', approved_at = COALESCE(approved_at, ?)';
      setParams.push(now);
    }

    if (options?.rejectedAt) {
      sql += ', rejected_at = ?';
      setParams.push(options.rejectedAt);
    } else if (toStatus === 'rejected') {
      sql += ', rejected_at = COALESCE(rejected_at, ?)';
      setParams.push(now);
    }

    if (options?.appliedAt) {
      sql += ', applied_at = ?';
      setParams.push(options.appliedAt);
    } else if (toStatus === 'applied') {
      sql += ', applied_at = COALESCE(applied_at, ?)';
      setParams.push(now);
    }

    if (options?.expectedStatus) {
      if (Array.isArray(options.expectedStatus)) {
        whereConditions.push(`status IN (${options.expectedStatus.map(() => '?').join(', ')})`);
        whereParams.push(...options.expectedStatus);
      } else {
        whereConditions.push('status = ?');
        whereParams.push(options.expectedStatus);
      }
    }

    sql += ' WHERE ' + whereConditions.join(' AND ') + ' RETURNING *';
    const allParams = [...setParams, ...whereParams];

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...allParams) as RecoveryPlanRow | undefined;
    if (!row) {
      throw new Error(`Failed to update recovery plan status for ${id}: record not found or status constraint failed.`);
    }

    return this.rowToPlan(row);
  }

  private rowToPlan(row: RecoveryPlanRow): SavedRecoveryPlan {
    return {
      id: row.id,
      requestId: row.request_id,
      sourcePlanId: row.source_plan_id,
      status: row.status as RecoveryPlanStatus,
      planJson: row.plan_json,
      planningStart: row.planning_start,
      planningEnd: row.planning_end,
      snapshotHash: row.snapshot_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvedAt: row.approved_at ?? undefined,
      rejectedAt: row.rejected_at ?? undefined,
      appliedAt: row.applied_at ?? undefined,
    };
  }
}
