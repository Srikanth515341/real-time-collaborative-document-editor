import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

// Safety net so nothing fails silently outside of a request (errorHandler
// covers request-scoped errors; these cover anything else).
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception');
});

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'server listening');
});
