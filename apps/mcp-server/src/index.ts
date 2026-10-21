import { ConfigError, loadConfig } from './config.js';
import { SqliteScheduleRepository } from './data/sqliteScheduleRepository.js';
import { SqliteTaskRepository } from './data/sqliteTaskRepository.js';
import { countRows, initializeDatabase, type InitializedDatabase } from './db/database.js';
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

  // Open, migrate and seed SQLite before anything listens. A failure here is fatal: the
  // server never falls back to in-memory data.
  let database: InitializedDatabase;
  try {
    database = initializeDatabase(config.databasePath, logger);
  } catch (error) {
    logger.error(`Failed to initialize the database: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const closeDatabase = (): void => {
    if (database.db.open) {
      database.db.close();
      logger.info('Database closed');
    }
  };

  let running;
  try {
    running = await startHttpServer(config, {
      repository: new SqliteScheduleRepository(database.db),
      taskRepository: new SqliteTaskRepository(database.db),
      logger,
    });
  } catch (error) {
    logger.error(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    try {
      closeDatabase();
    } catch (closeError) {
      logger.error(`Error closing database: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
    }
    process.exit(1);
  }

  const counts = countRows(database.db);
  logger.info('PlanRescue MCP Server');
  logger.info(`Name: ${SERVER_NAME} v${SERVER_VERSION} | Environment: ${config.appEnv}`);
  logger.info('Transport: Streamable HTTP');
  logger.info(`Endpoint: ${running.url}`);
  logger.info(`Health check: ${new URL('/healthz', running.url).href}`);
  logger.info(`Tool registered: ${running.toolNames.join(', ')}`);
  logger.info(
    `Data source: SQLite ${database.path} (schema v${database.schemaVersion}, ${counts.events} events, ${counts.tasks} tasks)`,
  );
  logger.info(`Database seeding: inserted ${database.seeded.eventsInserted} events, ${database.seeded.tasksInserted} tasks`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    try {
      // Stop accepting and drain HTTP first so no request can touch a closed database.
      await running.close();
      closeDatabase();
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
