/** Thrown by a repository when asked for something it cannot query, such as an inverted range or an unknown status. */
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

/** Thrown when the SQLite database cannot be opened, migrated or seeded. The message is safe to show to an operator. */
export class DatabaseInitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseInitError';
  }
}

export type RecoveryInputErrorCode = 'invalid_interval' | 'invalid_disruption' | 'unknown_event' | 'too_large';

/**
 * Thrown by the Recovery Engine when a request is well-formed but cannot be analysed, such as a
 * disruption that names an event that is not in the planning interval. Tools turn it into a
 * clear tool error; the validator turns it into a failed check.
 */
export class RecoveryInputError extends Error {
  constructor(
    public readonly code: RecoveryInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryInputError';
  }
}
