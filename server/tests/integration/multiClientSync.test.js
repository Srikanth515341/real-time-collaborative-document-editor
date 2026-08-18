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

// ---------------------------------------------------------------------------
// Phase 9: multi-client convergence proof. crdtMerge.test.js already proves
// Yjs's convergence guarantee in complete isolation (no network, no server).
// This proves the SAME guarantee holds end-to-end through the real server:
// 3 real authenticated WebSocket clients, with real permission grants,
// firing genuinely concurrent, overlapping (same-position) edits at the
// same document -- and the server's own merged state converging to an
// identical result regardless of the order those edits actually arrive in.
// ---------------------------------------------------------------------------

function decodeContent(base64) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(base64, 'base64'));
  return doc.getText('content').toString();
}

// Builds three DIFFERENT clients' updates, all inserting at position 0 of
// the SAME empty starting state -- i.e. genuinely overlapping/concurrent
// edits at the identical position, not just three edits at different
// positions (which convergence would trivially handle). This is the
// hardest, most meaningful case for the CRDT's tie-breaking to prove
// correct on.
function makeThreeConcurrentEdits() {
  const base = new Y.Doc();
  const baseState = Y.encodeStateAsUpdate(base);

  function fork(text) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, baseState);
    doc.getText('content').insert(0, text);
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  }

  return {
    fromAlice: fork('[Alice]'),
    fromBob: fork('[Bob]'),
    fromCarol: fork('[Carol]'),
  };
}

// Sends `message` on `senderWs` and waits until every socket in
// `listenerWsList` has received the corresponding broadcast, so the caller
// can be sure the server has fully processed this update (applied it to its
// authoritative Y.Doc and relayed it) before sending the next one. This is
// what makes the "explicit order" scenarios below deterministic rather than
// racing on network/event-loop timing.
function sendAndConfirmBroadcast(senderWs, listenerWsList, message) {
  const confirmations = listenerWsList.map(
    (ws) =>
      new Promise((resolve) => {
        function onMessage(raw) {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === 'sync-update' && parsed.update === message.update) {
            ws.off('message', onMessage);
            resolve();
          }
        }
        ws.on('message', onMessage);
      })
  );
  senderWs.send(JSON.stringify(message));
  return Promise.all(confirmations);
}

// Runs one full scenario against a FRESH document: three users join, apply
// the three (pre-generated, shared across all scenarios) concurrent edits
// in whatever order `applyEdits` chooses, then a fourth "observer" client
// joins late and reads back the server's authoritative merged state via its
// sync-step -- exactly the same mechanism the "late joiner" test above
// already relies on, so this needs no new server code whatsoever.
async function runConvergenceScenario({ owner, editorB, editorC, edits, applyEdits }) {
  const doc = await createDocument(owner.accessToken);
  await grantPermission(owner.accessToken, doc.id, editorB.email, 'editor');
  await grantPermission(owner.accessToken, doc.id, editorC.email, 'editor');

  const wsAlice = await connectWs();
  const wsBob = await connectWs();
  const wsCarol = await connectWs();
  send(wsAlice, { type: 'join-document', documentId: doc.id, token: owner.accessToken });
  send(wsBob, { type: 'join-document', documentId: doc.id, token: editorB.accessToken });
  send(wsCarol, { type: 'join-document', documentId: doc.id, token: editorC.accessToken });
  await Promise.all([nextMessage(wsAlice), nextMessage(wsBob), nextMessage(wsCarol)]);

  await applyEdits({ wsAlice, wsBob, wsCarol, edits, documentId: doc.id });

  const observerWs = await connectWs();
  send(observerWs, { type: 'join-document', documentId: doc.id, token: owner.accessToken });
  const syncStep = await nextMessage(observerWs);

  wsAlice.close();
  wsBob.close();
  wsCarol.close();
  observerWs.close();

  return decodeContent(syncStep.update);
}

test('3 concurrent clients editing the same document converge to an identical result across 3 different delivery orderings', async () => {
  const owner = await registerUser('Alice');
  const editorB = await registerUser('Bob');
  const editorC = await registerUser('Carol');
  const edits = makeThreeConcurrentEdits();

  // Scenario 1: all three fire "simultaneously" (no explicit ordering --
  // whatever the network/event loop happens to interleave).
  const resultSimultaneous = await runConvergenceScenario({
    owner,
    editorB,
    editorC,
    edits,
    applyEdits: async ({ wsAlice, wsBob, wsCarol, edits: e, documentId }) => {
      await Promise.all([
        new Promise((resolve) => {
          wsBob.once('message', resolve); // Bob observes Alice's broadcast
          wsAlice.send(
            JSON.stringify({ type: 'sync-update', documentId, update: e.fromAlice })
          );
        }),
        new Promise((resolve) => {
          wsCarol.once('message', resolve); // Carol observes Bob's broadcast
          wsBob.send(JSON.stringify({ type: 'sync-update', documentId, update: e.fromBob }));
        }),
        new Promise((resolve) => {
          wsAlice.once('message', resolve); // Alice observes Carol's broadcast
          wsCarol.send(
            JSON.stringify({ type: 'sync-update', documentId, update: e.fromCarol })
          );
        }),
      ]);
    },
  });

  // Scenario 2: strict explicit order Carol -> Alice -> Bob, each one
  // confirmed fully applied before the next is sent.
  const resultCarolAliceBob = await runConvergenceScenario({
    owner,
    editorB,
    editorC,
    edits,
    applyEdits: async ({ wsAlice, wsBob, wsCarol, edits: e, documentId }) => {
      await sendAndConfirmBroadcast(wsCarol, [wsAlice, wsBob], {
        type: 'sync-update',
        documentId,
        update: e.fromCarol,
      });
      await sendAndConfirmBroadcast(wsAlice, [wsBob, wsCarol], {
        type: 'sync-update',
        documentId,
        update: e.fromAlice,
      });
      await sendAndConfirmBroadcast(wsBob, [wsAlice, wsCarol], {
        type: 'sync-update',
        documentId,
        update: e.fromBob,
      });
    },
  });

  // Scenario 3: strict explicit order Bob -> Carol -> Alice -- the reverse
  // of scenario 2's first/last, and a different order than scenario 1's
  // race, to genuinely exercise different interleavings.
  const resultBobCarolAlice = await runConvergenceScenario({
    owner,
    editorB,
    editorC,
    edits,
    applyEdits: async ({ wsAlice, wsBob, wsCarol, edits: e, documentId }) => {
      await sendAndConfirmBroadcast(wsBob, [wsAlice, wsCarol], {
        type: 'sync-update',
        documentId,
        update: e.fromBob,
      });
      await sendAndConfirmBroadcast(wsCarol, [wsAlice, wsBob], {
        type: 'sync-update',
        documentId,
        update: e.fromCarol,
      });
      await sendAndConfirmBroadcast(wsAlice, [wsBob, wsCarol], {
        type: 'sync-update',
        documentId,
        update: e.fromAlice,
      });
    },
  });

  // The core claim: regardless of which of these three genuinely different
  // delivery orders happened, the server's own authoritative merged state
  // is byte-for-byte identical.
  assert.equal(resultSimultaneous, resultCarolAliceBob);
  assert.equal(resultCarolAliceBob, resultBobCarolAlice);

  // And nobody's edit was lost or corrupted in the merge.
  assert.ok(resultSimultaneous.includes('[Alice]'), 'Alice\'s edit is present');
  assert.ok(resultSimultaneous.includes('[Bob]'), "Bob's edit is present");
  assert.ok(resultSimultaneous.includes('[Carol]'), "Carol's edit is present");
  assert.equal(resultSimultaneous.length, '[Alice]'.length + '[Bob]'.length + '[Carol]'.length);
});
