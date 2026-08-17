import * as Y from 'yjs';
import { getOrCreateRoom, addClientToRoom } from '../roomManager.js';
import { logger } from '../../utils/logger.js';
import { verify } from '../../utils/jwt.js';
import { ensureUserCanAccess } from '../../services/documentService.js';

function sendErrorAndClose(client, code, message, closeCode) {
  client.send(JSON.stringify({ type: 'error', code, message }));
  client.close(closeCode, code);
}

// Verifies the JWT and the caller's permission on the document (at least
// 'viewer') before letting them join the room — the exact same standard
// every REST write path already holds itself to (PRD.md Section 10.7: never
// trust what the client claims, verify server-side on every write path).
// This closes the intentional Phase 6 gap where join-document accepted a
// bare `userId` at face value (see that phase's joinDocument.js history) —
// this phase's whole purpose is wiring the isolated CRDT engine into the
// real, authenticated system.
export async function handleJoinDocument(client, message) {
  const { documentId, token } = message;
  if (!documentId || !token) {
    sendErrorAndClose(
      client,
      'INVALID_MESSAGE',
      'join-document requires documentId and token.',
      1008
    );
    return;
  }

  let decoded;
  try {
    decoded = verify(token);
  } catch {
    sendErrorAndClose(client, 'UNAUTHORIZED', 'Invalid or expired token.', 4001);
    return;
  }
  const userId = decoded.userId;

  try {
    await ensureUserCanAccess({ documentId, userId, requiredRole: 'viewer' });
  } catch (err) {
    if (err.code === 'PERMISSION_DENIED') {
      sendErrorAndClose(client, 'PERMISSION_DENIED', err.message, 4003);
    } else {
      logger.error({ err, documentId, userId }, 'unexpected error checking document access');
      sendErrorAndClose(client, 'INTERNAL_ERROR', 'Something went wrong.', 1011);
    }
    return;
  }

  const room = await getOrCreateRoom(documentId);
  addClientToRoom(room, client, { userId });
  client.room = room;
  client.userId = userId;
  client.documentId = documentId;

  // Send the room's current authoritative state so a joining client starts
  // from wherever the document currently is, per TECHNICAL_DESIGN.md
  // Section 4 / PRD.md Section 11 step 2.
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
