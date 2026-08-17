import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { pool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';
import { attachWebSocketServer } from '../../src/websocket/wsServer.js';
import { resetTables } from '../db/helpers.js';

// Exercises the real, production-wired WebSocket gateway: real HTTP server +
// real WebSocket server on the same port (mirroring index.js exactly), real
// JWTs minted via the actual register endpoint, real permission grants via
// the actual permissions REST API. No shortcuts, no fakes -- this is what an
// actual client connecting to the actual server would experience.

let server;
let baseHttpUrl;
let baseWsUrl;

before(async () => {
  const app = createApp();
  server = http.createServer(app);
  attachWebSocketServer(server);
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  baseHttpUrl = `http://localhost:${port}`;
  baseWsUrl = `ws://localhost:${port}`;
});

beforeEach(resetTables);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

let userCounter = 0;
async function registerUser(displayName) {
  userCounter += 1;
  const email = `${displayName.toLowerCase()}-${userCounter}@example.com`;
  const res = await fetch(`${baseHttpUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', displayName }),
  });
  const body = await res.json();
  return { ...body.user, accessToken: body.accessToken };
}

async function createDocument(ownerToken) {
  const res = await fetch(`${baseHttpUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ title: 'Sync test doc' }),
  });
  return res.json();
}

async function grantPermission(ownerToken, docId, email, role) {
  await fetch(`${baseHttpUrl}/api/documents/${docId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ email, role }),
  });
}

function connectWs() {
  return new Promise((resolve) => {
    const ws = new WebSocket(baseWsUrl);
    ws.on('open', () => resolve(ws));
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function makeYUpdate(text) {
  const doc = new Y.Doc();
  doc.getText('content').insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

test("an editor's sync-update is accepted and broadcast to other clients in the room", async () => {
  const owner = await registerUser('Owner');
  const editor = await registerUser('Editor');
  const doc = await createDocument(owner.accessToken);
  await grantPermission(owner.accessToken, doc.id, editor.email, 'editor');

  const ownerWs = await connectWs();
  send(ownerWs, { type: 'join-document', documentId: doc.id, token: owner.accessToken });
  assert.equal((await nextMessage(ownerWs)).type, 'sync-step');

  const editorWs = await connectWs();
  send(editorWs, { type: 'join-document', documentId: doc.id, token: editor.accessToken });
  assert.equal((await nextMessage(editorWs)).type, 'sync-step');

  const ownerReceivedPromise = nextMessage(ownerWs);
  const update = makeYUpdate('hello from editor');
  send(editorWs, { type: 'sync-update', documentId: doc.id, update });
  const ownerReceived = await ownerReceivedPromise;

  assert.equal(ownerReceived.type, 'sync-update');
  assert.equal(ownerReceived.update, update);
  assert.equal(ownerReceived.fromUserId, editor.id);

  ownerWs.close();
  editorWs.close();
});

test("a viewer's sync-update is rejected with PERMISSION_DENIED and never applied or broadcast", async () => {
  const owner = await registerUser('Owner');
  const viewer = await registerUser('Viewer');
  const doc = await createDocument(owner.accessToken);
  await grantPermission(owner.accessToken, doc.id, viewer.email, 'viewer');

  const ownerWs = await connectWs();
  send(ownerWs, { type: 'join-document', documentId: doc.id, token: owner.accessToken });
  await nextMessage(ownerWs);

  const viewerWs = await connectWs();
  send(viewerWs, { type: 'join-document', documentId: doc.id, token: viewer.accessToken });
  await nextMessage(viewerWs);

  // Race a "did the owner get anything?" listener against a short timeout,
  // set up BEFORE sending, so we can positively assert nothing was
  // broadcast — not just that the viewer got an error.
  const ownerSilenceCheck = Promise.race([
    nextMessage(ownerWs).then(() => 'unexpected-message-received'),
    new Promise((resolve) => setTimeout(() => resolve('silence-as-expected'), 500)),
  ]);
  const viewerErrorPromise = nextMessage(viewerWs);

  send(viewerWs, { type: 'sync-update', documentId: doc.id, update: makeYUpdate('should not land') });

  const viewerError = await viewerErrorPromise;
  assert.equal(viewerError.type, 'error');
  assert.equal(viewerError.code, 'PERMISSION_DENIED');

  assert.equal(await ownerSilenceCheck, 'silence-as-expected');

  ownerWs.close();
  viewerWs.close();
});

test('a connection with an invalid JWT is refused at join-document and the socket is closed', async () => {
  const owner = await registerUser('Owner');
  const doc = await createDocument(owner.accessToken);

  const ws = await connectWs();
  const errorPromise = nextMessage(ws);
  const closePromise = new Promise((resolve) => ws.once('close', resolve));

  send(ws, { type: 'join-document', documentId: doc.id, token: 'not-a-real-jwt' });

  const error = await errorPromise;
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'UNAUTHORIZED');

  await closePromise; // resolves once the server actually closes the socket
});

test('joining without at least viewer access is rejected with PERMISSION_DENIED', async () => {
  const owner = await registerUser('Owner');
  const stranger = await registerUser('Stranger');
  const doc = await createDocument(owner.accessToken);

  const ws = await connectWs();
  const errorPromise = nextMessage(ws);
  const closePromise = new Promise((resolve) => ws.once('close', resolve));

  send(ws, { type: 'join-document', documentId: doc.id, token: stranger.accessToken });

  const error = await errorPromise;
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'PERMISSION_DENIED');
  await closePromise;
});

test('a joining client receives the operations a previous editor already made, via loadDocumentState', async () => {
  // This exercises documentService.loadDocumentState indirectly: the first
  // client's edits are only in the in-memory room (no persistence exists
  // until Phase 11), so a second client joining the SAME still-open room
  // gets the merged in-memory state via its sync-step, exactly like the
  // Phase 6 "late joiner" scenario -- now under real auth.
  const owner = await registerUser('Owner');
  const editor = await registerUser('Editor');
  const doc = await createDocument(owner.accessToken);
  await grantPermission(owner.accessToken, doc.id, editor.email, 'editor');

  const ownerWs = await connectWs();
  send(ownerWs, { type: 'join-document', documentId: doc.id, token: owner.accessToken });
  await nextMessage(ownerWs);

  send(ownerWs, {
    type: 'sync-update',
    documentId: doc.id,
    update: makeYUpdate('owner wrote this first'),
  });
  // Give the server a tick to apply it before the next client joins.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const editorWs = await connectWs();
  send(editorWs, { type: 'join-document', documentId: doc.id, token: editor.accessToken });
  const syncStep = await nextMessage(editorWs);

  const decoded = new Y.Doc();
  Y.applyUpdate(decoded, Buffer.from(syncStep.update, 'base64'));
  assert.equal(decoded.getText('content').toString(), 'owner wrote this first');

  ownerWs.close();
  editorWs.close();
});
