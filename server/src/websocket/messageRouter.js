import { logger } from '../utils/logger.js';
import { handleJoinDocument } from './handlers/joinDocument.js';
import { handleSyncUpdate } from './handlers/syncUpdate.js';
import { handleLeaveDocument } from './handlers/leaveDocument.js';

const handlers = {
  'join-document': handleJoinDocument,
  'sync-update': handleSyncUpdate,
  'leave-document': handleLeaveDocument,
};

function sendError(client, code, message) {
  client.send(JSON.stringify({ type: 'error', code, message }));
}

// Parses an incoming raw WebSocket message and dispatches it to the matching
// handler by `type`. An unparseable message or an unknown type gets back a
// clear error response instead of being silently dropped. Handlers may be
// async (join-document and sync-update now do real DB/JWT work) — errors
// they don't handle internally are caught here so they can never take down
// the connection or the process silently.
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

  Promise.resolve(handler(client, message)).catch((err) => {
    logger.error({ err, messageType: message.type }, 'unhandled error in websocket message handler');
  });
}
