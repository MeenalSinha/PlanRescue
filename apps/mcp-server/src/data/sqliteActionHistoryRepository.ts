import type Database from 'better-sqlite3';
import {
  type ActionHistoryRepository,
  type ActionHistoryEntry,
  type NewActionHistoryEntry,
  type ActionHistoryQuery,
  type ActionType,
} from '../types.js';

interface ActionHistoryRow {
  id: string;
  recovery_plan_id: string;
  action_type: string;
  occurred_at: string;
  actor: string;
  details_json: string;
}

export class SqliteActionHistoryRepository implements ActionHistoryRepository {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
  }

  public async recordAction(entry: NewActionHistoryEntry): Promise<ActionHistoryEntry> {
    const id = entry.id ?? crypto.randomUUID();
    const occurredAt = entry.occurredAt ?? new Date().toISOString();
    const actor = entry.actor ?? 'local-user';
    const recoveryPlanId = entry.recoveryPlanId ?? '';
    const detailsJson = entry.detailsJson ?? '{}';

    const stmt = this.db.prepare(`
      INSERT INTO action_history (
        id,
        recovery_plan_id,
        action_type,
        occurred_at,
        actor,
        details_json
      ) VALUES (
        @id,
        @recoveryPlanId,
        @actionType,
        @occurredAt,
        @actor,
        @detailsJson
      )
      RETURNING *
    `);

    const row = stmt.get({
      id,
      recoveryPlanId,
      actionType: entry.actionType,
      occurredAt,
      actor,
      detailsJson,
    }) as ActionHistoryRow;

    return this.rowToEntry(row);
  }

  public async findActions(query: ActionHistoryQuery = {}): Promise<ActionHistoryEntry[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.recoveryPlanId) {
      conditions.push('recovery_plan_id = ?');
      params.push(query.recoveryPlanId);
    }

    if (query.actionType) {
      conditions.push('action_type = ?');
      params.push(query.actionType);
    }

    let sql = 'SELECT * FROM action_history';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Chronological order, with stable id secondary sort
    sql += ' ORDER BY occurred_at ASC, id ASC';

    if (query.limit && query.limit > 0) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ActionHistoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  private rowToEntry(row: ActionHistoryRow): ActionHistoryEntry {
    return {
      id: row.id,
      recoveryPlanId: row.recovery_plan_id || undefined,
      actionType: row.action_type as ActionType,
      occurredAt: row.occurred_at,
      actor: row.actor,
      detailsJson: row.details_json,
    };
  }
}
