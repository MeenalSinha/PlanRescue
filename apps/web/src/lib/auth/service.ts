import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import {
  DEFAULT_USER_ID,
  generateSessionToken,
  getAuthDatabase,
  hashPassword,
  hashToken,
  verifyPassword,
} from './db';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  User,
  UserPreferences,
} from './types';

export class AuthenticationError extends Error {
  constructor(message: string, public readonly code: string = 'unauthorized') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function mapRowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRowToPreferences(row: any): UserPreferences {
  return {
    userId: row.user_id,
    timezone: row.timezone,
    workingDays: JSON.parse(row.working_days_json || '[]'),
    workingHoursStart: row.working_hours_start,
    workingHoursEnd: row.working_hours_end,
    preferredStrategy: row.preferred_strategy,
    preferredBufferMinutes: row.preferred_buffer_minutes,
    focusPeriods: JSON.parse(row.focus_periods_json || '[]'),
    spatialComfort: JSON.parse(row.spatial_comfort_json || '{}'),
    updatedAt: row.updated_at,
  };
}

export class AuthService {
  private readonly db: Db;

  constructor(db?: Db) {
    this.db = db || getAuthDatabase();
  }

  public register(input: RegisterInput): AuthResponse {
    const existing = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(input.email);
    if (existing) {
      throw new AuthenticationError('An account with this email already exists', 'email_taken');
    }

    const userId = `usr_${randomUUID()}`;
    const now = new Date().toISOString();
    const passHash = hashPassword(input.password);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(userId, input.email.toLowerCase(), passHash, input.displayName, now, now);

      this.db
        .prepare(`
          INSERT INTO user_preferences (
            user_id, timezone, working_days_json, working_hours_start, working_hours_end,
            preferred_strategy, preferred_buffer_minutes, focus_periods_json,
            spatial_comfort_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          userId,
          'Asia/Kolkata',
          JSON.stringify(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
          '09:00',
          '18:00',
          'minimal_disruption',
          10,
          JSON.stringify([]),
          JSON.stringify({ viewDistance: 1.4, handRayEnabled: true, hapticFeedback: true }),
          now,
        );
    });
    tx();

    const user: User = {
      id: userId,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      createdAt: now,
      updatedAt: now,
    };

    const sessionToken = this.createSession(userId);
    const preferences = this.getPreferences(userId);

    return { user, sessionToken, preferences };
  }

  public login(input: LoginInput): AuthResponse {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(input.email.toLowerCase()) as any;

    if (!row || !verifyPassword(input.password, row.password_hash)) {
      throw new AuthenticationError('Invalid email or password', 'invalid_credentials');
    }

    const user = mapRowToUser(row);
    const sessionToken = this.createSession(user.id);
    const preferences = this.getPreferences(user.id);

    return { user, sessionToken, preferences };
  }

  public logout(sessionToken: string): void {
    const hashed = hashToken(sessionToken);
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashed);
  }

  public createSession(userId: string): string {
    const token = generateSessionToken();
    const hashed = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();

    this.db
      .prepare(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(hashed, userId, now.toISOString(), expiresAt);

    return token;
  }

  public getSession(sessionToken: string): { user: User; preferences: UserPreferences } | null {
    const hashed = hashToken(sessionToken);
    const now = new Date().toISOString();

    const sessionRow = this.db
      .prepare(`
        SELECT s.*, u.id as user_id, u.email, u.display_name, u.created_at as user_created_at, u.updated_at as user_updated_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `)
      .get(hashed, now) as any;

    if (!sessionRow) {
      return null;
    }

    // Extend session expiry (sliding expiration)
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(newExpiresAt, hashed);

    const user: User = {
      id: sessionRow.user_id,
      email: sessionRow.email,
      displayName: sessionRow.display_name,
      createdAt: sessionRow.user_created_at,
      updatedAt: sessionRow.user_updated_at,
    };

    const preferences = this.getPreferences(user.id);
    return { user, preferences };
  }

  public getPreferences(userId: string): UserPreferences {
    const row = this.db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .get(userId) as any;

    if (!row) {
      // Fallback default
      return {
        userId,
        timezone: 'Asia/Kolkata',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
        preferredStrategy: 'minimal_disruption',
        preferredBufferMinutes: 10,
        focusPeriods: [],
        spatialComfort: { viewDistance: 1.4, handRayEnabled: true, hapticFeedback: true },
        updatedAt: new Date().toISOString(),
      };
    }

    return mapRowToPreferences(row);
  }

  public updatePreferences(userId: string, partial: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences(userId);
    const updated: UserPreferences = {
      ...current,
      ...partial,
      userId,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(`
        INSERT INTO user_preferences (
          user_id, timezone, working_days_json, working_hours_start, working_hours_end,
          preferred_strategy, preferred_buffer_minutes, focus_periods_json,
          spatial_comfort_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          timezone = excluded.timezone,
          working_days_json = excluded.working_days_json,
          working_hours_start = excluded.working_hours_start,
          working_hours_end = excluded.working_hours_end,
          preferred_strategy = excluded.preferred_strategy,
          preferred_buffer_minutes = excluded.preferred_buffer_minutes,
          focus_periods_json = excluded.focus_periods_json,
          spatial_comfort_json = excluded.spatial_comfort_json,
          updated_at = excluded.updated_at
      `)
      .run(
        userId,
        updated.timezone,
        JSON.stringify(updated.workingDays),
        updated.workingHoursStart,
        updated.workingHoursEnd,
        updated.preferredStrategy,
        updated.preferredBufferMinutes,
        JSON.stringify(updated.focusPeriods),
        JSON.stringify(updated.spatialComfort),
        updated.updatedAt,
      );

    return updated;
  }

  public recordPlanOwnership(planId: string, userId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT OR IGNORE INTO user_plan_ownership (plan_id, user_id, created_at)
        VALUES (?, ?, ?)
      `)
      .run(planId, userId, now);
  }

  public verifyPlanOwnership(planId: string, userId: string): boolean {
    const row = this.db
      .prepare('SELECT user_id FROM user_plan_ownership WHERE plan_id = ?')
      .get(planId) as { user_id: string } | undefined;

    // If plan has no ownership recorded, it belongs to the system/default user
    if (!row) {
      return userId === DEFAULT_USER_ID;
    }

    return row.user_id === userId;
  }

  public getDefaultUser(): User {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(DEFAULT_USER_ID) as any;
    if (row) {
      return mapRowToUser(row);
    }
    return {
      id: DEFAULT_USER_ID,
      email: 'user@planrescue.local',
      displayName: 'PlanRescue Studio User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public authenticateRequest(request: Request): {
    user: User;
    preferences: UserPreferences;
    isDefault: boolean;
  } {
    let token: string | null = null;

    // 1. Check Authorization: Bearer <token>
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim();
    }

    // 2. Check Cookie: planrescue_session=<token>
    if (!token) {
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        const match = cookieHeader.match(/planrescue_session=([^;]+)/);
        if (match && match[1]) {
          token = match[1].trim();
        }
      }
    }

    if (token) {
      const session = this.getSession(token);
      if (session) {
        return { user: session.user, preferences: session.preferences, isDefault: false };
      }
    }

    // Fallback to default user for local dev/unauthenticated baseline tests
    const defaultUser = this.getDefaultUser();
    const defaultPreferences = this.getPreferences(DEFAULT_USER_ID);
    return { user: defaultUser, preferences: defaultPreferences, isDefault: true };
  }

  public exportUserData(userId: string): Record<string, unknown> {
    const userRow = this.db.prepare('SELECT id, email, display_name, created_at, updated_at FROM users WHERE id = ?').get(userId);
    const preferences = this.getPreferences(userId);
    const calendarAccounts = this.db.prepare('SELECT id, provider, account_email, sync_status, last_synced_at FROM external_calendar_accounts WHERE user_id = ?').all(userId);
    const calendarMappings = this.db.prepare('SELECT local_event_id, provider, provider_event_id, etag, last_synced_at FROM external_calendar_mappings WHERE user_id = ?').all(userId);
    const planOwnership = this.db.prepare('SELECT plan_id, created_at FROM user_plan_ownership WHERE user_id = ?').all(userId);

    return {
      user: userRow,
      preferences,
      calendarAccounts,
      calendarMappings,
      planOwnership,
      exportedAt: new Date().toISOString(),
    };
  }

  public deleteUserAccount(userId: string): boolean {
    const deleteTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM external_sync_outbox WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM external_calendar_mappings WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM external_calendar_accounts WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM user_plan_ownership WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
      const res = this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return res.changes > 0;
    });

    return deleteTx();
  }
}

let authServiceSingleton: AuthService | null = null;
export function getAuthService(): AuthService {
  if (!authServiceSingleton) {
    authServiceSingleton = new AuthService();
  }
  return authServiceSingleton;
}
