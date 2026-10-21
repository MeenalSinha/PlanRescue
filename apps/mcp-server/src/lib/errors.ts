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
