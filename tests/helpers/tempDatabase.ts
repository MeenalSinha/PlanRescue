import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempDatabase {
  /** Absolute path of a SQLite file that does not exist yet, inside a fresh temporary directory. */
  path: string;
  /** Remove the directory and everything in it (database, WAL and SHM files). */
  cleanup(): void;
}

/** Create an isolated database location so no test touches the development database. */
export function makeTempDatabase(): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'planrescue-test-'));
  return {
    path: join(dir, 'planrescue.sqlite'),
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore or retry asynchronously if locked by exiting child process on Windows
        setTimeout(() => {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            // Ignore temporary directory cleanup failure
          }
        }, 1000);
      }
    },
  };
}
