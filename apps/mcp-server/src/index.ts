import { ConfigError, loadConfig } from './config.js';
import { SeedScheduleRepository, SEED_TIME_ZONE, seedEvents } from './data/seedSchedule.js';
import { startHttpServer } from './http.js';
import { createLogger } from './logger.js';
import { SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\nSee .env.example for the supported variables.\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  const repository = new SeedScheduleRepository();

  let running;
  try {
    running = await startHttpServer(config, { repository, logger });
  } catch (error) {
    logger.error(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  logger.info('PlanRescue MCP Server');
  logger.info(`Name: ${SERVER_NAME} v${SERVER_VERSION} | Environment: ${config.appEnv}`);
  logger.info('Transport: Streamable HTTP');
  logger.info(`Endpoint: ${running.url}`);
  logger.info(`Health check: ${new URL('/healthz', running.url).href}`);
  logger.info(`Tool registered: ${running.toolNames.join(', ')}`);
  logger.info(`Data source: seeded schedule (${seedEvents.length} events, ${SEED_TIME_ZONE})`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    try {
      await running.close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.stack ?? error.message}`);
    void shutdown('uncaughtException');
  });
}

void main();
