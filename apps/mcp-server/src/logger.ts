export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Minimal line logger. Info and debug go to stdout, warnings and errors to stderr.
 * Callers are responsible for never passing secrets or personal data.
 */
export function createLogger(level: LogLevel): Logger {
  const min = ORDER[level];
  const emit = (lvl: LogLevel, message: string): void => {
    if (ORDER[lvl] < min) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${message}\n`;
    (ORDER[lvl] >= ORDER.warn ? process.stderr : process.stdout).write(line);
  };
  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
  };
}
