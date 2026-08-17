import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import * as documentsRepo from '../db/documents.repo.js';
import * as snapshotsRepo from '../db/snapshots.repo.js';
import * as documentService from '../services/documentService.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import permissionsRouter from './permissions.routes.js';

const router = Router();

router.use(authenticate);

// GET /api/documents — list documents the caller owns or has been granted access to.
router.get('/', async (req, res, next) => {
  try {
    const docs = await documentsRepo.listDocumentsForUser(req.user.userId);
    res.status(200).json(docs);
  } catch (err) {
    next(err);
  }
});

// POST /api/documents — create a document; caller becomes its owner.
router.post('/', async (req, res, next) => {
  try {
    const { title } = req.body ?? {};
    if (title !== undefined && title !== null && typeof title !== 'string') {
      throw new ValidationError('title must be a string.');
    }

    const document = await documentService.createNewDocument({
      ownerId: req.user.userId,
      title,
    });
    res.status(201).json(document);
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id — metadata + latest snapshot. Any role (viewer+) may read.
router.get('/:id', requireRole('viewer'), async (req, res, next) => {
  try {
    const document = await documentsRepo.getDocumentById(req.params.id);
    if (!document) {
      throw new NotFoundError('Document not found.');
    }
    const latestSnapshot = await documentService.loadDocumentState(req.params.id);
    res.status(200).json({ ...document, latestSnapshot });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/documents/:id — rename/archive. editor or owner.
router.patch('/:id', requireRole('editor'), async (req, res, next) => {
  try {
    const { title, isArchived } = req.body ?? {};
    if (title !== undefined && typeof title !== 'string') {
      throw new ValidationError('title must be a string.');
    }
    if (isArchived !== undefined && typeof isArchived !== 'boolean') {
      throw new ValidationError('isArchived must be a boolean.');
    }

    const updated = await documentsRepo.updateDocument(req.params.id, { title, isArchived });
    if (!updated) {
      throw new NotFoundError('Document not found.');
    }
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id — owner only. Cascades to permissions/snapshots/operation log.
router.delete('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    await documentsRepo.deleteDocument(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id/versions — list snapshots. Any role (viewer+) may read.
router.get('/:id/versions', requireRole('viewer'), async (req, res, next) => {
  try {
    const versions = await snapshotsRepo.listSnapshots(req.params.id);
    res.status(200).json(versions);
  } catch (err) {
    next(err);
  }
});

router.use('/:id/permissions', permissionsRouter);

export default router;
