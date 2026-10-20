import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../apps/mcp-server/src/server.js';

describe('server metadata', () => {
  it('SERVER_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
