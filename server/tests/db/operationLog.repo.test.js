import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import * as documentsRepo from '../../src/db/documents.repo.js';
import * as operationLogRepo from '../../src/db/operationLog.repo.js';
import { resetTables, insertTestUser } from './helpers.js';

beforeEach(resetTables);
after(() => pool.end());

async function makeDocument() {
  const owner = await insertTestUser();
  const doc = await documentsRepo.createDocument({ ownerId: owner.id, title: 'Doc' });
  return { owner, doc };
}

test('appendOperation stores a binary update and returns the created entry', async () => {
  const { owner, doc } = await makeDocument();
  const updateData = Buffer.from([9, 8, 7]);

  const entry = await operationLogRepo.appendOperation({
    documentId: doc.id,
    userId: owner.id,
    updateData,
  });

  assert.ok(Buffer.compare(entry.updateData, updateData) === 0);
  assert.equal(entry.userId, owner.id);
});

test('appendOperation allows a null userId for system-generated operations', async () => {
  const { doc } = await makeDocument();

  const entry = await operationLogRepo.appendOperation({
    documentId: doc.id,
    userId: null,
    updateData: Buffer.from([1]),
  });

  assert.equal(entry.userId, null);
});

test('getOperationsSince returns only operations strictly after the given timestamp, oldest first', async () => {
  const { owner, doc } = await makeDocument();
  const first = await operationLogRepo.appendOperation({
    documentId: doc.id,
    userId: owner.id,
    updateData: Buffer.from([1]),
  });
  const cutoff = new Date(first.createdAt.getTime() + 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await operationLogRepo.appendOperation({
    documentId: doc.id,
    userId: owner.id,
    updateData: Buffer.from([2]),
  });

  const results = await operationLogRepo.getOperationsSince({
    documentId: doc.id,
    sinceTimestamp: cutoff,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, second.id);
});

test('pruneOperationsBefore deletes only entries older than the given timestamp', async () => {
  const { owner, doc } = await makeDocument();
  const old = await operationLogRepo.appendOperation({
    documentId: doc.id,
    userId: owner.id,
    updateData: Buffer.from([1]),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const cutoff = new Date();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const recent = await operationLogRepo.appendOperation({
    documentId: doc.id,
    userId: owner.id,
    updateData: Buffer.from([2]),
  });

  await operationLogRepo.pruneOperationsBefore({ documentId: doc.id, timestamp: cutoff });

  const remaining = await operationLogRepo.getOperationsSince({
    documentId: doc.id,
    sinceTimestamp: new Date(0),
  });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, recent.id);
  assert.ok(!remaining.some((r) => r.id === old.id));
});
