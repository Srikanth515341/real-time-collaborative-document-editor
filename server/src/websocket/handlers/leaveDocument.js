import { removeClientFromRoom } from '../roomManager.js';
import { logger } from '../../utils/logger.js';

// Handles an explicit `leave-document` message (e.g. a client navigating
// away from a document without closing its whole socket). The disconnect
// path (ws 'close' event, in wsServer.js) calls removeClientFromRoom the
// same way, so both routes get the same grace-period-aware room cleanup
// (see roomManager.js).
export function handleLeaveDocument(client) {
  if (!client.room) {
    return;
  }
  logger.info({ documentId: client.documentId, userId: client.userId }, 'client sent leave-document');
  removeClientFromRoom(client.room, client);
  client.room = null;
  client.documentId = null;
}
