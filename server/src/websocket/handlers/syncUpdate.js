import * as Y from 'yjs';
import { logger } from '../../utils/logger.js';
import { broadcastToRoom } from '../roomManager.js';

// The single most important function in the whole backend
// (TECHNICAL_DESIGN.md Section 4): the server never decides whose edit
// "wins" -- it applies the incoming update to its own authoritative copy of
// the doc and relays it to every other client, and Yjs's CRDT guarantees
// that applying the same set of updates in any order converges to the same
// final document everywhere (proved in isolation by
// tests/unit/crdtMerge.test.js).
//
// Persistence (operation_log append + periodic snapshotting) is
// intentionally NOT done here -- that's Phase 11. This phase proves merge
// correctness first, in isolation, before anything depends on it.
export function handleSyncUpdate(client, message) {
  const room = client.room;
  if (!room) {
    client.send(
      JSON.stringify({
        type: 'error',
        code: 'NOT_IN_ROOM',
        message: 'Join a document before sending updates.',
      })
    );
    return;
  }

  let update;
  try {
    update = Buffer.from(message.update, 'base64');
    Y.applyUpdate(room.yDoc, update);
  } catch (err) {
    // A malformed update is logged and dropped -- it must never crash the
    // room or corrupt the shared state for everyone else in it.
    logger.warn({ err, documentId: room.documentId }, 'dropped malformed sync-update');
    client.send(
      JSON.stringify({
        type: 'error',
        code: 'INVALID_UPDATE',
        message: 'Update could not be applied.',
      })
    );
    return;
  }

  broadcastToRoom(
    room,
    {
      type: 'sync-update',
      documentId: room.documentId,
      update: message.update,
      fromUserId: client.userId,
    },
    client
  );
}
