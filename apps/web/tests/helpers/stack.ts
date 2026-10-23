/**
 * Boots the complete stack for end-to-end tests: the real built MCP server (own temporary SQLite
 * database) and the real production Next.js server pointed at it, each as a child process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

// Plain paths (no `new URL`) so this works under both the node and jsdom test environments.
const WEB_DIR = resolve(__dirname, '..', '..');
const NEXT_BIN = join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const MCP_ENTRY = resolve(WEB_DIR, '..', '..', 'dist', 'index.js');

export interface McpHandle {
  url: string;
  databasePath: string;
  logs(): string;
  stop(): Promise<void>;
}

export interface Stack {
  mcp: McpHandle;
  webUrl: string;
  webLogs(): string;
  /** Fingerprint of every SQLite table, from a separate read-only connection. */
  databaseFingerprint(): string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const a = probe.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitHealthy(origin: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`MCP server exited early.\n${logs()}`);
    try {
      if ((await fetch(`${origin}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`MCP server did not become healthy.\n${logs()}`);
}

/** Start the real built MCP server on a free port with its own temporary SQLite database. */
async function startMcp(): Promise<McpHandle> {
  if (!existsSync(MCP_ENTRY)) throw new Error('dist/index.js is missing. Run `npm run build` at the repository root first.');
  const dir = mkdtempSync(join(tmpdir(), 'planrescue-web-test-'));
  const databasePath = join(dir, 'planrescue.sqlite');
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, [MCP_ENTRY], {
    env: { ...process.env, MCP_HOST: '127.0.0.1', MCP_PORT: String(port), MCP_PATH: '/mcp', APP_ENV: 'test', LOG_LEVEL: 'info', MCP_ALLOWED_HOSTS: '', DATABASE_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (c: Buffer) => (output += c.toString()));
  child.stderr?.on('data', (c: Buffer) => (output += c.toString()));
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitHealthy(origin, child, () => output);
  } catch (error) {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    url: `${origin}/mcp`,
    databasePath,
    logs: () => output,
    stop: () =>
      new Promise<void>((done) => {
        const finish = (): void => {
          rmSync(dir, { recursive: true, force: true });
          done();
        };
        if (child.exitCode !== null) return finish();
        child.once('exit', finish);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }),
  };
}

export async function startStack(env: Record<string, string> = {}): Promise<Stack> {
  if (!existsSync(`${WEB_DIR}/.next/BUILD_ID`)) {
    throw new Error('apps/web/.next is missing. Run `npm run build --prefix apps/web` first (the root `npm run test:web` script does this).');
  }
  const mcp = await startMcp();
  const port = await freePort();
  let output = '';
  const web: ChildProcess = spawn(process.execPath, [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: WEB_DIR,
    env: { ...process.env, PLANRESCUE_MCP_URL: mcp.url, PLANRESCUE_MCP_TIMEOUT_MS: '5000', NODE_ENV: 'production', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  web.stdout?.on('data', (c: Buffer) => (output += c.toString()));
  web.stderr?.on('data', (c: Buffer) => (output += c.toString()));
  const webUrl = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (web.exitCode !== null) {
      await mcp.stop();
      throw new Error(`The web server exited early.\n${output}`);
    }
    try {
      if ((await fetch(webUrl)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      web.kill('SIGKILL');
      await mcp.stop();
      throw new Error(`The web server did not start in time.\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const dbPath = mcp.databasePath;
  return {
    mcp,
    webUrl,
    webLogs: () => output,
    databaseFingerprint: () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>;
        return createHash('sha256').update(JSON.stringify(tables.map((t) => [t.name, db.prepare(`select * from "${t.name}" order by 1`).all()]))).digest('hex');
      } finally {
        db.close();
      }
    },
    stop: async () => {
      await new Promise<void>((resolve) => {
        if (web.exitCode !== null) return resolve();
        web.once('exit', () => resolve());
        web.kill('SIGTERM');
        setTimeout(() => web.kill('SIGKILL'), 5_000).unref();
      });
      await mcp.stop();
    },
  };
}
