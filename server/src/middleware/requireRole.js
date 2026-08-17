import { ensureUserCanAccess } from '../services/documentService.js';

// Factory: requireRole('editor') returns middleware that checks the
// authenticated user's role on the :id document param against the required
// role, attaching the resolved role to req.userRole. Must run after
// authenticate (needs req.user). Denial surfaces as 403 via errorHandler,
// same as any other PermissionError.
export function requireRole(requiredRole) {
  return async (req, res, next) => {
    try {
      req.userRole = await ensureUserCanAccess({
        documentId: req.params.id,
        userId: req.user.userId,
        requiredRole,
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}
