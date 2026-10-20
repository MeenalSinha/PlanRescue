import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { buildPlanRescueServer, SERVER_NAME, SERVER_VERSION, type ServerDeps } from './server.js';

export interface RunningServer {
  /** Full MCP endpoint URL, using the actual bound port. */
  url: string;
  port: number;
  toolNames: string[];
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '']);

/** Hostnames accepted in Host/Origin headers (DNS rebinding protection). */
export function allowedHostnames(config: Pick<Config, 'host' | 'allowedHosts'>): string[] {
  const names = new Set<string>(LOOPBACK_HOSTS);
  if (!WILDCARD_HOSTS.has(config.host)) {
    names.add(config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host);
  }
  for (const host of config.allowedHosts) names.add(host);
  return [...names];
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * Start the Streamable HTTP MCP endpoint.
 *
 * Protocol handling is entirely the official SDK's: `createMcpHandler` serves the
 * 2026-07-28 protocol revision natively and falls back to stateless 2025-era
 * Streamable HTTP (including 2025-11-25) from the same tool definitions.
 */
export async function startHttpServer(config: Config, deps: ServerDeps & { logger: Logger }): Promise<RunningServer> {
  const { logger } = deps;

  // Build one instance up front: fails fast on a broken definition and tells us what is really registered.
  const { toolNames } = buildPlanRescueServer(deps);

  const mcpHandler = createMcpHandler(() => buildPlanRescueServer(deps).server, {
    onerror: (error) => logger.error(`MCP handler error: ${error.message}`),
  });
  const mcpNode = toNodeHandler(mcpHandler, {
    onerror: (error: Error) => logger.error(`MCP adapter error: ${error.message}`),
  });

  const names = allowedHostnames(config);
  const validateHost = hostHeaderValidation(names);
  const validateOrigin = originValidation(names);
  const startedAt = Date.now();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const began = performance.now();
    res.on('finish', () => {
      logger.debug(`HTTP ${req.method} ${req.url} -> ${res.statusCode} (${(performance.now() - began).toFixed(1)}ms)`);
    });

    // DNS rebinding protection. On rejection the guard has already answered with 403.
    if (!validateHost(req, res) || !validateOrigin(req, res)) {
      logger.warn(`Rejected request with disallowed Host/Origin: ${req.method} ${req.url}`);
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendJson(res, 400, { error: 'Bad request URL' });
      return;
    }

    if (pathname === config.path) {
      void mcpNode(req, res);
      return;
    }

    if (pathname === '/healthz' && req.method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        name: SERVER_NAME,
        version: SERVER_VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found', mcpEndpoint: config.path });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${config.port} on ${config.host} is already in use. Set MCP_PORT to a free port.`)
          : error,
      );
    };
    server.once('error', onError);
    server.listen(config.port, config.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const hostForUrl = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const displayHost = WILDCARD_HOSTS.has(config.host) ? 'localhost' : hostForUrl;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await mcpHandler.close();
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => server.closeAllConnections(), 3000);
        force.unref();
        server.close(() => {
          clearTimeout(force);
          resolve();
        });
        server.closeIdleConnections();
      });
    })();
    return closing;
  };

  return { url: `http://${displayHost}:${address.port}${config.path}`, port: address.port, toolNames, close };
}
