import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { makeTempDatabase } from './tempDatabase.js';

export interface ServerHandle {
  /** Full MCP endpoint URL the tests connect to. */
  url: string;
  /** Origin (scheme, host, port) of the server. */
  origin: string;
  /** True when pointing at an already-running server via MCP_URL (no process owned, no logs captured). */
  external: boolean;
  /** SQLite file the server was started with; undefined when attached to an external server. */
  databasePath?: string;
  /** Everything the server process has written to stdout and stderr so far. */
  logs(): string;
  /** Ask the server to shut down with SIGTERM and report how it exited. */
  stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface StartServerOptions {
  /** SQLite file for this server instance. Defaults to a fresh temporary database owned by the handle. */
  databasePath?: string;
  /** Extra environment variables, applied last (used to provoke startup failures). */
  env?: Record<string, string>;
}

const ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(origin: string, child: ChildProcess | undefined, logs: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}.\n${logs()}`);
    }
    try {
      const res = await fetch(`${origin}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not become healthy in time.\n${logs()}`);
}

/**
 * Start the real, built PlanRescue server as a child process on a free port, or attach to a
 * server that is already running when MCP_URL is set (for example `npm run start:mcp`).
 */
export async function startServer(options: StartServerOptions = {}): Promise<ServerHandle> {
  const externalUrl = process.env.MCP_URL;
  if (externalUrl) {
    const origin = new URL(externalUrl).origin;
    await waitForHealth(origin, undefined, () => '');
    return {
      url: externalUrl,
      origin,
      external: true,
      logs: () => '',
      stop: async () => ({ code: 0, signal: null }),
    };
  }

  if (!existsSync(ENTRY)) {
    throw new Error('dist/index.js not found. Run `npm run build` first (or use `npm run test:mcp`, which builds).');
  }

  const ownedDatabase = options.databasePath === undefined ? makeTempDatabase() : undefined;
  const databasePath = options.databasePath ?? ownedDatabase!.path;
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
      MCP_PATH: '/mcp',
      APP_ENV: 'test',
      LOG_LEVEL: 'info',
      MCP_ALLOWED_HOSTS: '',
      DATABASE_PATH: databasePath,
      ...(options.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const origin = `http://127.0.0.1:${port}`;
  const logs = (): string => output;
  try {
    await waitForHealth(origin, child, logs);
  } catch (error) {
    child.kill('SIGKILL');
    ownedDatabase?.cleanup();
    throw error;
  }

  return {
    url: `${origin}/mcp`,
    origin,
    external: false,
    databasePath,
    logs,
    stop: () =>
      new Promise((resolve) => {
        const finish = (result: { code: number | null; signal: NodeJS.Signals | null }): void => {
          ownedDatabase?.cleanup(); // only a database this handle created is removed
          resolve(result);
        };
        if (child.exitCode !== null || child.signalCode !== null) {
          finish({ code: child.exitCode, signal: child.signalCode });
          return;
        }
        const force = setTimeout(() => child.kill('SIGKILL'), 8000);
        child.once('exit', (code, signal) => {
          clearTimeout(force);
          finish({ code, signal });
        });
        child.kill('SIGTERM');
      }),
  };
}
