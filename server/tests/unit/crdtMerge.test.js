import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

// This is the single most important test in the project. It proves the core
// claim the entire sync architecture depends on: applying the same set of
// Yjs CRDT updates, in ANY order, on ANY number of separate documents,
// always converges to an identical final state. That's what lets the server
// get away with "just relay every update to everyone" instead of having to
// decide whose edit "wins" -- there is no winner to decide.

function docTextOf(doc) {
  return doc.getText('content').toString();
}

test('two concurrent, non-overlapping edits converge to the same state regardless of merge order', () => {
  const clientA = new Y.Doc();
  clientA.getText('content').insert(0, 'Hello world');

  // B starts from exactly what A has so far, then the two diverge.
  const clientB = new Y.Doc();
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA));

  clientA.getText('content').insert(0, 'A says: ');
  clientB.getText('content').insert(clientB.getText('content').length, ' -- B was here');

  const updateFromA = Y.encodeStateAsUpdate(clientA);
  const updateFromB = Y.encodeStateAsUpdate(clientB);

  const mergedForward = new Y.Doc();
  Y.applyUpdate(mergedForward, updateFromA);
  Y.applyUpdate(mergedForward, updateFromB);

  const mergedReverse = new Y.Doc();
  Y.applyUpdate(mergedReverse, updateFromB);
  Y.applyUpdate(mergedReverse, updateFromA);

  assert.equal(docTextOf(mergedForward), docTextOf(mergedReverse));
  assert.equal(docTextOf(mergedForward), 'A says: Hello world -- B was here');
});

test('three-way concurrent edits converge to an identical result under every one of the 6 possible merge orders', () => {
  const shared = new Y.Doc();
  shared.getText('content').insert(0, 'The quick fox');
  const sharedState = Y.encodeStateAsUpdate(shared);

  function forkAndEdit(editFn) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, sharedState);
    editFn(doc.getText('content'));
    return Y.encodeStateAsUpdate(doc);
  }

  const updateAlice = forkAndEdit((t) => t.insert(0, 'Alice: '));
  const updateBob = forkAndEdit((t) => t.insert(4, 'brown ')); // "The [brown ]quick fox"
  const updateCarol = forkAndEdit((t) => t.insert(t.length, ' -- reviewed by Carol'));

  const results = new Set();
  for (const order of permutations([updateAlice, updateBob, updateCarol])) {
    const doc = new Y.Doc();
    for (const update of order) {
      Y.applyUpdate(doc, update);
    }
    results.add(docTextOf(doc));
  }

  assert.equal(
    results.size,
    1,
    `expected every merge order to converge to one result, got ${results.size} distinct outcomes: ${[...results].join(' | ')}`
  );
});

test('applying the same update twice (duplicate delivery) does not change the result', () => {
  const source = new Y.Doc();
  source.getText('content').insert(0, 'idempotent');
  const update = Y.encodeStateAsUpdate(source);

  const target = new Y.Doc();
  Y.applyUpdate(target, update);
  const afterOnce = docTextOf(target);
  Y.applyUpdate(target, update);
  const afterTwice = docTextOf(target);

  assert.equal(afterOnce, 'idempotent');
  assert.equal(afterOnce, afterTwice);
});

test('many small concurrent edits from 5 clients converge identically across repeated random shuffles', () => {
  const NUM_CLIENTS = 5;
  const EDITS_PER_CLIENT = 4;
  const NUM_SHUFFLE_TRIALS = 8;

  const shared = new Y.Doc();
  shared.getText('content').insert(0, 'base text ');
  const sharedState = Y.encodeStateAsUpdate(shared);

  const clientUpdates = [];
  for (let c = 0; c < NUM_CLIENTS; c += 1) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, sharedState);
    const text = doc.getText('content');
    for (let e = 0; e < EDITS_PER_CLIENT; e += 1) {
      const pos = Math.floor(Math.random() * (text.length + 1));
      text.insert(pos, `[c${c}e${e}]`);
    }
    clientUpdates.push(Y.encodeStateAsUpdate(doc));
  }

  let expected = null;
  for (let trial = 0; trial < NUM_SHUFFLE_TRIALS; trial += 1) {
    const doc = new Y.Doc();
    for (const update of shuffled(clientUpdates)) {
      Y.applyUpdate(doc, update);
    }
    const result = docTextOf(doc);
    if (expected === null) {
      expected = result;
    } else {
      assert.equal(result, expected, `shuffle trial ${trial} diverged from trial 0's converged result`);
    }
  }
});

function permutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }
  return result;
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
