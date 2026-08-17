import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import * as documentsRepo from '../../src/db/documents.repo.js';
import * as permissionsRepo from '../../src/db/permissions.repo.js';
import { resetTables, insertTestUser } from './helpers.js';

beforeEach(resetTables);
after(() => pool.end());

test('createDocument creates a document owned by the given user, defaulting the title', async () => {
  const owner = await insertTestUser();

  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: null });

  assert.equal(doc.ownerId, owner.id);
  assert.equal(doc.title, 'Untitled Document');
  assert.equal(doc.isArchived, false);
  assert.ok(doc.id);
});

test('createDocument uses the given title when provided', async () => {
  const owner = await insertTestUser();

  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'My Doc' });

  assert.equal(doc.title, 'My Doc');
});

test('getDocumentById returns null for a document that does not exist', async () => {
  const result = await documentsRepo.getDocumentById('00000000-0000-0000-0000-000000000000');
  assert.equal(result, null);
});

test('getDocumentById returns the matching document', async () => {
  const owner = await insertTestUser();
  const created = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Found Me' });

  const found = await documentsRepo.getDocumentById(created.id);

  assert.equal(found.id, created.id);
  assert.equal(found.title, 'Found Me');
});

test('listDocumentsForUser returns only documents the user has a permission grant on', async () => {
  const owner = await insertTestUser();
  const stranger = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Shared' });
  await permissionsRepo.grantPermission({ documentId: doc.id, userId: owner.id, role: 'owner' });

  const ownerDocs = await documentsRepo.listDocumentsForUser(owner.id);
  const strangerDocs = await documentsRepo.listDocumentsForUser(stranger.id);

  assert.equal(ownerDocs.length, 1);
  assert.equal(ownerDocs[0].id, doc.id);
  assert.equal(strangerDocs.length, 0);
});

test('updateDocument updates only the fields provided', async () => {
  const owner = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Original' });

  const renamed = await documentsRepo.updateDocument(doc.id, { title: 'Renamed' });
  assert.equal(renamed.title, 'Renamed');
  assert.equal(renamed.isArchived, false);

  const archived = await documentsRepo.updateDocument(doc.id, { isArchived: true });
  assert.equal(archived.title, 'Renamed');
  assert.equal(archived.isArchived, true);
});

test('deleteDocument removes the document and cascades to its permissions', async () => {
  const owner = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'To Delete' });
  await permissionsRepo.grantPermission({ documentId: doc.id, userId: owner.id, role: 'owner' });

  await documentsRepo.deleteDocument(doc.id);

  assert.equal(await documentsRepo.getDocumentById(doc.id), null);
  assert.equal(await permissionsRepo.getUserRole({ documentId: doc.id, userId: owner.id }), null);
});
