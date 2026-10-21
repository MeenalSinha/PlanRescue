import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../apps/mcp-server/src/config.js';
import { allowedHostnames } from '../apps/mcp-server/src/http.js';

describe('parseConfig', () => {
  it('applies local-development defaults', () => {
    expect(parseConfig({}, '/work')).toEqual({
      host: '127.0.0.1',
      port: 3001,
      path: '/mcp',
      appEnv: 'development',
      logLevel: 'info',
      allowedHosts: [],
      databasePath: resolve('/work', 'data/planrescue.sqlite'),
    });
  });

  it('reads overrides and normalises the path and host list', () => {
    const config = parseConfig({
      MCP_HOST: '0.0.0.0',
      MCP_PORT: '4010',
      MCP_PATH: '/api/mcp/',
      APP_ENV: 'production',
      LOG_LEVEL: 'debug',
      MCP_ALLOWED_HOSTS: ' a.example.com , b.example.com ,',
    });
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 4010,
      path: '/api/mcp',
      appEnv: 'production',
      logLevel: 'debug',
      allowedHosts: ['a.example.com', 'b.example.com'],
    });
  });

  it('treats empty strings as unset', () => {
    expect(parseConfig({ MCP_PORT: '', MCP_PATH: '' }).port).toBe(3001);
    expect(parseConfig({ DATABASE_PATH: '' }, '/work').databasePath).toBe(resolve('/work', 'data/planrescue.sqlite'));
  });

  describe('DATABASE_PATH', () => {
    it('resolves a relative path against the base directory', () => {
      expect(parseConfig({ DATABASE_PATH: 'var/db.sqlite' }, '/srv/app').databasePath).toBe(resolve('/srv/app', 'var/db.sqlite'));
      expect(parseConfig({ DATABASE_PATH: './x/../y.sqlite' }, '/srv/app').databasePath).toBe(resolve('/srv/app', 'y.sqlite'));
    });

    it('keeps an absolute path as given', () => {
      expect(parseConfig({ DATABASE_PATH: '/var/lib/planrescue/plan.sqlite' }, '/srv/app').databasePath).toBe(
        '/var/lib/planrescue/plan.sqlite',
      );
    });

    it('defaults to the process working directory as base', () => {
      expect(parseConfig({}).databasePath).toBe(resolve(process.cwd(), 'data/planrescue.sqlite'));
    });

    it.each([[':memory:'], ['file:plan.db?mode=memory']])('rejects the non-persistent location %s', (value) => {
      expect(() => parseConfig({ DATABASE_PATH: value })).toThrow(ConfigError);
      expect(() => parseConfig({ DATABASE_PATH: value })).toThrow(/DATABASE_PATH/);
    });
  });

  it.each([
    ['non-numeric port', { MCP_PORT: 'abc' }],
    ['port out of range', { MCP_PORT: '70000' }],
    ['path without leading slash', { MCP_PATH: 'mcp' }],
    ['unknown environment', { APP_ENV: 'staging' }],
    ['unknown log level', { LOG_LEVEL: 'verbose' }],
  ])('rejects %s with a ConfigError', (_label, env) => {
    expect(() => parseConfig(env)).toThrow(ConfigError);
  });
});

describe('allowedHostnames', () => {
  it('always includes loopback names', () => {
    expect(allowedHostnames({ host: '127.0.0.1', allowedHosts: [] })).toEqual(
      expect.arrayContaining(['localhost', '127.0.0.1', '[::1]']),
    );
  });

  it('adds explicitly allowed hosts and the bound host, but never a wildcard', () => {
    const names = allowedHostnames({ host: '0.0.0.0', allowedHosts: ['mcp.example.com'] });
    expect(names).toContain('mcp.example.com');
    expect(names).not.toContain('0.0.0.0');
  });
});
