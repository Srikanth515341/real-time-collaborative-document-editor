import * as Y from 'yjs';
import * as documentsRepo from '../db/documents.repo.js';
import * as permissionsRepo from '../db/permissions.repo.js';
import * as snapshotsRepo from '../db/snapshots.repo.js';
import * as operationLogRepo from '../db/operationLog.repo.js';
import { withTransaction } from '../db/withTransaction.js';
import { satisfiesRole } from './permissionService.js';
import { PermissionError } from '../utils/errors.js';

// Throws PermissionError if userId's role on documentId doesn't meet
// requiredRole. Called at the top of every write path, REST and WebSocket
// alike.
export async function ensureUserCanAccess({ documentId, userId, requiredRole }) {
  const role = await permissionsRepo.getUserRole({ documentId, userId });
  if (!satisfiesRole(role, requiredRole)) {
    throw new PermissionError('You do not have access to this document.');
  }
  return role;
}

// Creates a document and grants its creator 'owner' permission, atomically —
// either both happen or neither does, so a document can never exist without
// an owner.
export async function createNewDocument({ ownerId, title }) {
  return withTransaction(async (client) => {
    const document = await documentsRepo.createDocument({ ownerId, title }, client);
    await permissionsRepo.grantPermission(
      { documentId: document.id, userId: ownerId, role: 'owner' },
      client
    );
    return document;
  });
}

// Loads a document's last-saved state into a fresh, fully hydrated Y.Doc:
// starts from the latest snapshot (if one exists), then replays every
// operation-log entry created after that snapshot's timestamp, in order.
// Returns the hydrated Y.Doc (not the raw snapshot row — that's the whole
// point, this is what roomManager.getOrCreateRoom uses directly).
//
// Snapshot *writing* doesn't exist until Phase 11, and neither does
// operation-log *writing* on sync-update (that's also Phase 11) — so today
// this will almost always return a brand-new empty Y.Doc, since there's
// nothing yet to load or replay. That's expected, not a bug: this phase
// only builds the read/hydration path, so it's already correct and ready
// for Phase 11 to start writing into.
export async function loadDocumentState(documentId) {
  const yDoc = new Y.Doc();

  const latestSnapshot = await snapshotsRepo.getLatestSnapshot(documentId);
  if (latestSnapshot) {
    Y.applyUpdate(yDoc, latestSnapshot.snapshotData);
  }
  const sinceTimestamp = latestSnapshot ? latestSnapshot.createdAt : new Date(0);

  const operations = await operationLogRepo.getOperationsSince({ documentId, sinceTimestamp });
  for (const operation of operations) {
    Y.applyUpdate(yDoc, operation.updateData);
  }

  return yDoc;
}
