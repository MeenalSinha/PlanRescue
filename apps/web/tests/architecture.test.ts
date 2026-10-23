// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('the frontend stays on the MCP side of the boundary', () => {
  const stripComments = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sources = files(SRC).map((p) => ({ path: p.slice(SRC.length + 1), text: stripComments(readFileSync(p, 'utf8')) }));

  it('never imports SQLite, the MCP server code or the Recovery Engine', () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/from ['"]better-sqlite3['"]/);
      expect(text, path).not.toMatch(/from ['"][^'"]*mcp-server[^'"]*['"]/);
      expect(text, path).not.toMatch(/from ['"][^'"]*recovery\/(analyzeConflicts|generateRecoveryPlans|validateRecoveryPlan|placement|scoring|taskCapacity)[^'"]*['"]/);
    }
  });

  it('uses the official MCP client only from the server-side helper', () => {
    const users = sources.filter((s) => s.text.includes('@modelcontextprotocol/')).map((s) => s.path);
    expect(users).toEqual(['lib/mcpClient.ts']);
  });

  it('exposes only the four allow-listed routes, each calling a fixed tool', () => {
    const routes = sources.filter((s) => s.path.startsWith('app/api/')).map((s) => s.path.replace(/\\/g, '/')).sort();
    expect(routes).toEqual(['app/api/dashboard/route.ts', 'app/api/recovery/analyze/route.ts', 'app/api/recovery/propose/route.ts', 'app/api/recovery/validate/route.ts']);
    for (const r of sources.filter((s) => s.path.startsWith('app/api/'))) {
      const calls = [...r.text.matchAll(/callMcpTool\(/g)].map((m) => r.text.slice(m.index! + m[0].length).trimStart()[0]);
      expect(calls.length, r.path).toBeGreaterThan(0);
      for (const first of calls) expect(first, r.path).toMatch(/['"]/);
    }
  });

  it('sends no server configuration to the browser', () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/NEXT_PUBLIC_/);
      if (path.startsWith('components/')) expect(text, path).not.toMatch(/process\.env/);
    }
  });

  it('offers no way to apply a plan', () => {
    for (const { path, text } of sources) expect(text, path).not.toMatch(/apply_approved_plan|Approve and apply/i);
  });
});
