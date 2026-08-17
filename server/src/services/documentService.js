import * as documentsRepo from '../db/documents.repo.js';
import * as permissionsRepo from '../db/permissions.repo.js';
import * as snapshotsRepo from '../db/snapshots.repo.js';
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

// Loads the document's last-saved state. For now (Phase 4) this just returns
// the latest snapshot row as-is; full Yjs hydration + operation-log replay on
// top of it is built in Phase 7 (TECHNICAL_DESIGN.md Section 4's
// loadDocumentState -> Y.Doc). Returns null if the document has never been
// snapshotted yet.
export async function loadDocumentState(documentId) {
  return snapshotsRepo.getLatestSnapshot(documentId);
}
