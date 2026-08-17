import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger.js';
import { routeMessage } from './messageRouter.js';
import { removeClientFromRoom } from './roomManager.js';

// Attaches a WebSocket server to the given HTTP server, upgrading HTTP
// connections to WebSocket on the same port (per TECHNICAL_DESIGN.md
// Section 1's backend architecture: REST + WebSocket share one server).
export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (client) => {
    logger.info('websocket client connected');

    client.on('message', (raw) => {
      routeMessage(client, raw);
    });

    client.on('close', () => {
      logger.info({ userId: client.userId, documentId: client.documentId }, 'websocket client disconnected');
      if (client.room) {
        removeClientFromRoom(client.room, client);
      }
    });

    client.on('error', (err) => {
      logger.error({ err }, 'websocket client error');
    });
  });

  return wss;
}
