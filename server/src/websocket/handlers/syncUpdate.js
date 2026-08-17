import * as Y from 'yjs';
import { logger } from '../../utils/logger.js';
import { broadcastToRoom } from '../roomManager.js';
import { ensureUserCanAccess } from '../../services/documentService.js';

// The single most important function in the whole backend
// (TECHNICAL_DESIGN.md Section 4): the server never decides whose edit
// "wins" -- it applies the incoming update to its own authoritative copy of
// the doc and relays it to every other client, and Yjs's CRDT guarantees
// that applying the same set of updates in any order converges to the same
// final document everywhere (proved in isolation by
// tests/unit/crdtMerge.test.js).
//
// As of this phase, every sync-update is gated by the same 'editor'
// requirement as the REST write paths (PATCH /api/documents/:id etc.) — a
// viewer's update is rejected with PERMISSION_DENIED and never applied or
// broadcast, exactly matching PRD.md Section 10.7's server-side enforcement
// rule.
//
// Persistence (operation_log append + periodic snapshotting) is
// intentionally NOT done here -- that's Phase 11.
export async function handleSyncUpdate(client, message) {
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

  try {
    await ensureUserCanAccess({
      documentId: room.documentId,
      userId: client.userId,
      requiredRole: 'editor',
    });
  } catch (err) {
    if (err.code === 'PERMISSION_DENIED') {
      client.send(JSON.stringify({ type: 'error', code: 'PERMISSION_DENIED', message: err.message }));
    } else {
      logger.error(
        { err, documentId: room.documentId, userId: client.userId },
        'unexpected error checking edit permission'
      );
      client.send(
        JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong.' })
      );
    }
    return; // Denied -- do NOT apply or broadcast the update.
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
