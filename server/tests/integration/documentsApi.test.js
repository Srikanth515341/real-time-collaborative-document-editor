import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';
import { resetTables } from '../db/helpers.js';

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

beforeEach(resetTables);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function api(path, { method = 'GET', token, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let userCounter = 0;
async function registerUser(displayName = 'User') {
  userCounter += 1;
  const email = `${displayName.toLowerCase()}-${userCounter}@example.com`;
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'correct horse battery staple', displayName },
  });
  const body = await res.json();
  return { ...body.user, accessToken: body.accessToken };
}

async function createDocument(ownerToken, title = 'Doc') {
  const res = await api('/api/documents', { method: 'POST', token: ownerToken, body: { title } });
  return res.json();
}

test('full document lifecycle: create, list, rename, delete', async () => {
  const owner = await registerUser('Owner');

  const created = await createDocument(owner.accessToken, 'Spec Draft');
  assert.equal(created.title, 'Spec Draft');
  assert.equal(created.ownerId, owner.id);

  const listRes = await api('/api/documents', { token: owner.accessToken });
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  const getRes = await api(`/api/documents/${created.id}`, { token: owner.accessToken });
  const fetched = await getRes.json();
  assert.equal(getRes.status, 200);
  assert.equal(fetched.title, 'Spec Draft');
  assert.equal(fetched.latestSnapshot, null);

  const patchRes = await api(`/api/documents/${created.id}`, {
    method: 'PATCH',
    token: owner.accessToken,
    body: { title: 'Renamed Draft' },
  });
  const patched = await patchRes.json();
  assert.equal(patchRes.status, 200);
  assert.equal(patched.title, 'Renamed Draft');

  const deleteRes = await api(`/api/documents/${created.id}`, {
    method: 'DELETE',
    token: owner.accessToken,
  });
  assert.equal(deleteRes.status, 204);

  const getAfterDeleteRes = await api(`/api/documents/${created.id}`, { token: owner.accessToken });
  assert.equal(getAfterDeleteRes.status, 403);
});

test('creating a document atomically grants the creator owner permission', async () => {
  const owner = await registerUser('Owner');
  const doc = await createDocument(owner.accessToken);

  const { rows } = await pool.query(
    'SELECT role FROM document_permissions WHERE document_id = $1 AND user_id = $2',
    [doc.id, owner.id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'owner');
});

test('deleting a document cascades to its permissions', async () => {
  const owner = await registerUser('Owner');
  const doc = await createDocument(owner.accessToken);

  await api(`/api/documents/${doc.id}`, { method: 'DELETE', token: owner.accessToken });

  const { rows } = await pool.query('SELECT * FROM document_permissions WHERE document_id = $1', [
    doc.id,
  ]);
  assert.equal(rows.length, 0);
});

test('owner can grant editor access, and the editor can then write (rename)', async () => {
  const owner = await registerUser('Owner');
  const editor = await registerUser('Editor');
  const doc = await createDocument(owner.accessToken);

  const grantRes = await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: owner.accessToken,
    body: { email: editor.email, role: 'editor' },
  });
  const grant = await grantRes.json();
  assert.equal(grantRes.status, 201);
  assert.equal(grant.role, 'editor');
  assert.equal(grant.userId, editor.id);

  const patchRes = await api(`/api/documents/${doc.id}`, {
    method: 'PATCH',
    token: editor.accessToken,
    body: { title: 'Edited by editor' },
  });
  assert.equal(patchRes.status, 200);
});

test('a viewer is rejected with 403 on every write operation', async () => {
  const owner = await registerUser('Owner');
  const viewer = await registerUser('Viewer');
  const doc = await createDocument(owner.accessToken);
  await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: owner.accessToken,
    body: { email: viewer.email, role: 'viewer' },
  });

  const patchRes = await api(`/api/documents/${doc.id}`, {
    method: 'PATCH',
    token: viewer.accessToken,
    body: { title: 'Should not work' },
  });
  const deleteRes = await api(`/api/documents/${doc.id}`, {
    method: 'DELETE',
    token: viewer.accessToken,
  });
  const grantRes = await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: viewer.accessToken,
    body: { email: owner.email, role: 'editor' },
  });

  assert.equal(patchRes.status, 403);
  assert.equal(deleteRes.status, 403);
  assert.equal(grantRes.status, 403);

  // But a viewer can still read.
  const getRes = await api(`/api/documents/${doc.id}`, { token: viewer.accessToken });
  assert.equal(getRes.status, 200);
});

test('a non-owner editor cannot manage permissions (list/grant/revoke all 403)', async () => {
  const owner = await registerUser('Owner');
  const editor = await registerUser('Editor');
  const stranger = await registerUser('Stranger');
  const doc = await createDocument(owner.accessToken);
  await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: owner.accessToken,
    body: { email: editor.email, role: 'editor' },
  });

  const listRes = await api(`/api/documents/${doc.id}/permissions`, { token: editor.accessToken });
  const grantRes = await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: editor.accessToken,
    body: { email: stranger.email, role: 'viewer' },
  });
  const revokeRes = await api(`/api/documents/${doc.id}/permissions/${owner.id}`, {
    method: 'DELETE',
    token: editor.accessToken,
  });

  assert.equal(listRes.status, 403);
  assert.equal(grantRes.status, 403);
  assert.equal(revokeRes.status, 403);
});

test('owner can revoke a granted permission, after which access is denied', async () => {
  const owner = await registerUser('Owner');
  const editor = await registerUser('Editor');
  const doc = await createDocument(owner.accessToken);
  await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: owner.accessToken,
    body: { email: editor.email, role: 'editor' },
  });

  const revokeRes = await api(`/api/documents/${doc.id}/permissions/${editor.id}`, {
    method: 'DELETE',
    token: owner.accessToken,
  });
  assert.equal(revokeRes.status, 204);

  const getRes = await api(`/api/documents/${doc.id}`, { token: editor.accessToken });
  assert.equal(getRes.status, 403);
});

test('granting the owner role through the endpoint is rejected', async () => {
  const owner = await registerUser('Owner');
  const other = await registerUser('Other');
  const doc = await createDocument(owner.accessToken);

  const res = await api(`/api/documents/${doc.id}/permissions`, {
    method: 'POST',
    token: owner.accessToken,
    body: { email: other.email, role: 'owner' },
  });

  assert.equal(res.status, 400);
});

test("revoking the document owner's own permission is rejected", async () => {
  const owner = await registerUser('Owner');
  const doc = await createDocument(owner.accessToken);

  const res = await api(`/api/documents/${doc.id}/permissions/${owner.id}`, {
    method: 'DELETE',
    token: owner.accessToken,
  });

  assert.equal(res.status, 400);
});

test('all document/permission endpoints require authentication', async () => {
  const owner = await registerUser('Owner');
  const doc = await createDocument(owner.accessToken);

  const listRes = await api('/api/documents');
  const getRes = await api(`/api/documents/${doc.id}`);
  const createRes = await api('/api/documents', { method: 'POST', body: { title: 'x' } });

  assert.equal(listRes.status, 401);
  assert.equal(getRes.status, 401);
  assert.equal(createRes.status, 401);
});
