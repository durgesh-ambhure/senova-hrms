import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { ensureDefaultRoles } from './modules/roles/role.service.js';
import { createApp } from './app.js';

async function main() {
  await connectDatabase(env.MONGODB_URI);
  await ensureDefaultRoles();

  const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT }, 'Senova API listening'));

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
