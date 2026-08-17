import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import * as permissionsRepo from '../db/permissions.repo.js';
import * as usersRepo from '../db/users.repo.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

// Mounted at /api/documents/:id/permissions with mergeParams so req.params.id
// is available here. authenticate already ran on the parent documents router.
const router = Router({ mergeParams: true });

// 'owner' is deliberately not grantable through this endpoint: PRD.md
// Section 10.7 specifies exactly one owner per document (the creator), and
// ownership transfer isn't part of this phase's scope.
const GRANTABLE_ROLES = ['editor', 'viewer'];

router.get('/', requireRole('owner'), async (req, res, next) => {
  try {
    const grants = await permissionsRepo.listPermissionsForDocument(req.params.id);
    res.status(200).json(grants);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('owner'), async (req, res, next) => {
  try {
    const { email, role } = req.body ?? {};

    if (typeof email !== 'string' || email.length === 0) {
      throw new ValidationError('A valid email is required.');
    }
    if (!GRANTABLE_ROLES.includes(role)) {
      throw new ValidationError(`role must be one of: ${GRANTABLE_ROLES.join(', ')}.`);
    }

    const user = await usersRepo.findUserByEmail(email);
    if (!user) {
      throw new NotFoundError('No user with that email was found.');
    }

    // grantPermission upserts on (document_id, user_id), so granting
    // editor/viewer to a user who already holds 'owner' on this document
    // would silently overwrite (downgrade) their owner permission. Blocked
    // here for the same reason 'owner' isn't grantable and the owner's
    // access isn't revocable below: exactly one owner per document.
    const existingRole = await permissionsRepo.getUserRole({
      documentId: req.params.id,
      userId: user.id,
    });
    if (existingRole === 'owner') {
      throw new ValidationError("The document owner's role cannot be changed through this endpoint.");
    }

    const grant = await permissionsRepo.grantPermission({
      documentId: req.params.id,
      userId: user.id,
      role,
    });
    res.status(201).json(grant);
  } catch (err) {
    next(err);
  }
});

router.delete('/:userId', requireRole('owner'), async (req, res, next) => {
  try {
    const currentRole = await permissionsRepo.getUserRole({
      documentId: req.params.id,
      userId: req.params.userId,
    });
    // The document's owner permission can't be revoked through this endpoint
    // — doing so would leave the document without an owner. Deleting the
    // document itself (owner-only) is the only way to remove an owner grant.
    if (currentRole === 'owner') {
      throw new ValidationError("The document owner's access cannot be revoked.");
    }

    await permissionsRepo.revokePermission({
      documentId: req.params.id,
      userId: req.params.userId,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
