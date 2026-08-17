import * as Y from 'yjs';
import { getOrCreateRoom, addClientToRoom } from '../roomManager.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// SECURITY NOTE -- INTENTIONAL, NOT AN OVERSIGHT:
// This handler does NOT verify a JWT and does NOT check document
// permissions. It accepts whatever `userId` the client claims in the
// message body at face value. That is deliberately insecure and safe only
// for local, isolated testing of the CRDT merge engine (this phase's whole
// point, per ROADMAP.md Phase 6). Every other write path in this codebase
// (every REST route) verifies auth + role server-side, per PRD.md Section
// 10.7's "never trust what the client claims" rule -- this handler is the
// one deliberate, temporary exception, and Phase 7 ("WebSocket Gateway --
// Production Integration") closes it by verifying the JWT and calling
// documentService.ensureUserCanAccess here, exactly like the REST routes do.
// ============================================================================
export function handleJoinDocument(client, message) {
  const { documentId, userId } = message;
  if (!documentId || !userId) {
    client.send(
      JSON.stringify({
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'join-document requires documentId and userId.',
      })
    );
    return;
  }

  const room = getOrCreateRoom(documentId);
  addClientToRoom(room, client, { userId });
  client.room = room;
  client.userId = userId;
  client.documentId = documentId;

  // Send the room's current authoritative state so a joining client starts
  // from wherever the document currently is, per TECHNICAL_DESIGN.md
  // Section 4 / PRD.md Section 11 step 2 ("server ... sends a sync-step with
  // the current authoritative state").
  const stateUpdate = Y.encodeStateAsUpdate(room.yDoc);
  client.send(
    JSON.stringify({
      type: 'sync-step',
      documentId,
      update: Buffer.from(stateUpdate).toString('base64'),
    })
  );

  logger.info({ documentId, userId }, 'client joined document room');
}
