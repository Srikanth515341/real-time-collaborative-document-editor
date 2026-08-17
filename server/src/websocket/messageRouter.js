import { logger } from '../utils/logger.js';
import { handleJoinDocument } from './handlers/joinDocument.js';
import { handleSyncUpdate } from './handlers/syncUpdate.js';

const handlers = {
  'join-document': handleJoinDocument,
  'sync-update': handleSyncUpdate,
};

function sendError(client, code, message) {
  client.send(JSON.stringify({ type: 'error', code, message }));
}

// Parses an incoming raw WebSocket message and dispatches it to the matching
// handler by `type`. An unparseable message or an unknown type gets back a
// clear error response instead of being silently dropped.
export function routeMessage(client, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch (err) {
    logger.warn({ err }, 'received malformed (non-JSON) websocket message');
    sendError(client, 'MALFORMED_MESSAGE', 'Message must be valid JSON.');
    return;
  }

  const handler = handlers[message.type];
  if (!handler) {
    sendError(client, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
    return;
  }

  handler(client, message);
}
