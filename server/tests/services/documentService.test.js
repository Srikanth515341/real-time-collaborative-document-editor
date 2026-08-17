import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import * as documentsRepo from '../../src/db/documents.repo.js';
import * as permissionsRepo from '../../src/db/permissions.repo.js';
import * as documentService from '../../src/services/documentService.js';
import { resetTables, insertTestUser } from '../db/helpers.js';

beforeEach(resetTables);
after(() => pool.end());

test('ensureUserCanAccess resolves with the role when it meets the requirement', async () => {
  const owner = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Doc' });
  await permissionsRepo.grantPermission({ documentId: doc.id, userId: owner.id, role: 'owner' });

  const role = await documentService.ensureUserCanAccess({
    documentId: doc.id,
    userId: owner.id,
    requiredRole: 'editor',
  });

  assert.equal(role, 'owner');
});

test('ensureUserCanAccess throws PermissionError when the role is insufficient', async () => {
  const owner = await insertTestUser();
  const viewer = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Doc' });
  await permissionsRepo.grantPermission({ documentId: doc.id, userId: viewer.id, role: 'viewer' });

  await assert.rejects(
    () =>
      documentService.ensureUserCanAccess({
        documentId: doc.id,
        userId: viewer.id,
        requiredRole: 'editor',
      }),
    (err) => err.statusCode === 403 && err.code === 'PERMISSION_DENIED'
  );
});

test('ensureUserCanAccess throws PermissionError when the user has no grant at all', async () => {
  const owner = await insertTestUser();
  const stranger = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Doc' });

  await assert.rejects(() =>
    documentService.ensureUserCanAccess({
      documentId: doc.id,
      userId: stranger.id,
      requiredRole: 'viewer',
    })
  );
});
