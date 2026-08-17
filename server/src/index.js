import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { attachWebSocketServer } from './websocket/wsServer.js';

// Safety net so nothing fails silently outside of a request (errorHandler
// covers request-scoped errors; these cover anything else).
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception');
});

const app = createApp();
const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'server listening');
});
