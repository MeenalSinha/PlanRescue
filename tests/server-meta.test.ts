import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../apps/mcp-server/src/server.js';

describe('server metadata', () => {
  it('SERVER_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it('keeps install scripts disabled so `npm ci` uses better-sqlite3 prebuilt binaries instead of compiling', () => {
    // Without this, `npm ci` runs `node-gyp rebuild` for better-sqlite3 and needs a C++ toolchain and network access.
    const npmrc = readFileSync(new URL('../.npmrc', import.meta.url), 'utf8');
    expect(npmrc).toMatch(/^ignore-scripts=true$/m);
  });
});
