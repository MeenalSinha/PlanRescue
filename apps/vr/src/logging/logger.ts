import type { LogLevel } from '../config/schema';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export type LogListener = (record: LogRecord) => void;

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /auth/i,
  /key/i,
  /credential/i,
  /bearer/i,
  /cookie/i,
];

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Deeply scrubs sensitive keys and values from logging payloads.
 */
export function redactSensitiveData(val: unknown, depth = 0): unknown {
  if (depth > 5) return '[Truncated: Max Depth]';
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    if (/bearer\s+[a-z0-9._~+/-]+=*/i.test(val)) {
      return val.replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
    }
    return val;
  }
  if (typeof val !== 'object') return val;

  if (Array.isArray(val)) {
    return val.map((item) => redactSensitiveData(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(k))) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = redactSensitiveData(v, depth + 1);
    }
  }
  return sanitized;
}

export class VrLogger {
  private currentLevel: LogLevel;
  private readonly listeners: Set<LogListener> = new Set();

  constructor(level: LogLevel = 'info') {
    this.currentLevel = level;
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  getLevel(): LogLevel {
    return this.currentLevel;
  }

  addListener(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[this.currentLevel];
  }

  private write(level: LogLevel, category: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    let sanitizedData: Record<string, unknown> | undefined;
    if (data instanceof Error) {
      sanitizedData = { name: data.name, message: data.message, stack: data.stack };
    } else if (data && typeof data === 'object') {
      sanitizedData = redactSensitiveData(data as Record<string, unknown>) as Record<string, unknown>;
    } else if (data !== undefined) {
      sanitizedData = { value: String(data) };
    }

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      ...(sanitizedData ? { data: sanitizedData } : {}),
    };

    // Emit to listeners
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // Listener error must never crash logging
      }
    }

    // Console output
    const prefix = `[${record.timestamp}] [${record.level.toUpperCase()}] [${record.category}] ${record.message}`;
    switch (level) {
      case 'debug':
        if (typeof console !== 'undefined' && console.debug) {
          sanitizedData ? console.debug(prefix, sanitizedData) : console.debug(prefix);
        }
        break;
      case 'info':
        if (typeof console !== 'undefined' && console.info) {
          sanitizedData ? console.info(prefix, sanitizedData) : console.info(prefix);
        }
        break;
      case 'warn':
        if (typeof console !== 'undefined' && console.warn) {
          sanitizedData ? console.warn(prefix, sanitizedData) : console.warn(prefix);
        }
        break;
      case 'error':
        if (typeof console !== 'undefined' && console.error) {
          sanitizedData ? console.error(prefix, sanitizedData) : console.error(prefix);
        }
        break;
    }
  }

  debug(category: string, message: string, data?: unknown): void {
    this.write('debug', category, message, data);
  }

  info(category: string, message: string, data?: unknown): void {
    this.write('info', category, message, data);
  }

  warn(category: string, message: string, data?: unknown): void {
    this.write('warn', category, message, data);
  }

  error(category: string, message: string, data?: unknown): void {
    this.write('error', category, message, data);
  }
}

export const logger = new VrLogger();
