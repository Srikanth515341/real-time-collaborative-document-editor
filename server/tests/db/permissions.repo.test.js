import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import * as documentsRepo from '../../src/db/documents.repo.js';
import * as permissionsRepo from '../../src/db/permissions.repo.js';
import { resetTables, insertTestUser } from './helpers.js';

beforeEach(resetTables);
after(() => pool.end());

async function makeDocument() {
  const owner = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Doc' });
  return { owner, doc };
}

test('grantPermission grants a role and getUserRole reflects it', async () => {
  const { owner, doc } = await makeDocument();

  await permissionsRepo.grantPermission({ documentId: doc.id, userId: owner.id, role: 'owner' });

  const role = await permissionsRepo.getUserRole({ documentId: doc.id, userId: owner.id });
  assert.equal(role, 'owner');
});

test('getUserRole returns null when no permission has been granted', async () => {
  const { doc } = await makeDocument();
  const stranger = await insertTestUser();

  const role = await permissionsRepo.getUserRole({ documentId: doc.id, userId: stranger.id });
  assert.equal(role, null);
});

test('grantPermission upserts: re-granting a different role updates it rather than erroring', async () => {
  const { doc } = await makeDocument();
  const collaborator = await insertTestUser();

  await permissionsRepo.grantPermission({
    documentId: doc.id,
    userId: collaborator.id,
    role: 'viewer',
  });
  await permissionsRepo.grantPermission({
    documentId: doc.id,
    userId: collaborator.id,
    role: 'editor',
  });

  const role = await permissionsRepo.getUserRole({ documentId: doc.id, userId: collaborator.id });
  assert.equal(role, 'editor');
});

test('revokePermission removes access', async () => {
  const { doc } = await makeDocument();
  const collaborator = await insertTestUser();
  await permissionsRepo.grantPermission({
    documentId: doc.id,
    userId: collaborator.id,
    role: 'editor',
  });

  await permissionsRepo.revokePermission({ documentId: doc.id, userId: collaborator.id });

  const role = await permissionsRepo.getUserRole({ documentId: doc.id, userId: collaborator.id });
  assert.equal(role, null);
});

test('listPermissionsForDocument lists every grant for the document', async () => {
  const { owner, doc } = await makeDocument();
  const collaborator = await insertTestUser();
  await permissionsRepo.grantPermission({ documentId: doc.id, userId: owner.id, role: 'owner' });
  await permissionsRepo.grantPermission({
    documentId: doc.id,
    userId: collaborator.id,
    role: 'viewer',
  });

  const grants = await permissionsRepo.listPermissionsForDocument(doc.id);

  assert.equal(grants.length, 2);
  assert.deepEqual(
    grants.map((g) => g.role).sort(),
    ['owner', 'viewer']
  );
});

test('the role CHECK constraint rejects a value outside owner/editor/viewer', async () => {
  const { owner, doc } = await makeDocument();

  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO document_permissions (document_id, user_id, role) VALUES ($1, $2, $3)`,
        [doc.id, owner.id, 'superadmin']
      ),
    /violates check constraint/
  );
});
