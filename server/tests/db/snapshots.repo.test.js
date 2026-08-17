import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import * as documentsRepo from '../../src/db/documents.repo.js';
import * as snapshotsRepo from '../../src/db/snapshots.repo.js';
import { resetTables, insertTestUser } from './helpers.js';

beforeEach(resetTables);
after(() => pool.end());

async function makeDocument() {
  const owner = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Doc' });
  return { owner, doc };
}

test('saveSnapshot round-trips binary snapshot data unchanged', async () => {
  const { owner, doc } = await makeDocument();
  const snapshotData = Buffer.from([1, 2, 3, 255, 0, 128]);

  const saved = await snapshotsRepo.saveSnapshot({
    documentId: doc.id,
    snapshotData,
    versionLabel: 'Draft for review',
    createdBy: owner.id,
  });

  assert.ok(Buffer.compare(saved.snapshotData, snapshotData) === 0);
  assert.equal(saved.versionLabel, 'Draft for review');
  assert.equal(saved.createdBy, owner.id);
});

test('getLatestSnapshot returns null when no snapshots exist', async () => {
  const { doc } = await makeDocument();
  assert.equal(await snapshotsRepo.getLatestSnapshot(doc.id), null);
});

test('getLatestSnapshot returns the most recently created snapshot', async () => {
  const { owner, doc } = await makeDocument();
  await snapshotsRepo.saveSnapshot({
    documentId: doc.id,
    snapshotData: Buffer.from('first'),
    createdBy: owner.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await snapshotsRepo.saveSnapshot({
    documentId: doc.id,
    snapshotData: Buffer.from('second'),
    createdBy: owner.id,
  });

  const latest = await snapshotsRepo.getLatestSnapshot(doc.id);
  assert.equal(latest.id, second.id);
});

test('listSnapshots lists every snapshot for the document, newest first', async () => {
  const { owner, doc } = await makeDocument();
  await snapshotsRepo.saveSnapshot({
    documentId: doc.id,
    snapshotData: Buffer.from('a'),
    createdBy: owner.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await snapshotsRepo.saveSnapshot({
    documentId: doc.id,
    snapshotData: Buffer.from('b'),
    createdBy: owner.id,
  });

  const list = await snapshotsRepo.listSnapshots(doc.id);

  assert.equal(list.length, 2);
  assert.ok(list[0].createdAt >= list[1].createdAt);
});
