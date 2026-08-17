import * as permissionsRepo from '../db/permissions.repo.js';
import { satisfiesRole } from './permissionService.js';
import { PermissionError } from '../utils/errors.js';

// Throws PermissionError if userId's role on documentId doesn't meet
// requiredRole. Called at the top of every write path, REST and WebSocket
// alike — the rest of documentService.js is built in Phase 4.
export async function ensureUserCanAccess({ documentId, userId, requiredRole }) {
  const role = await permissionsRepo.getUserRole({ documentId, userId });
  if (!satisfiesRole(role, requiredRole)) {
    throw new PermissionError('You do not have access to this document.');
  }
  return role;
}
