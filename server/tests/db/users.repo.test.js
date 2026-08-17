import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import * as usersRepo from '../../src/db/users.repo.js';
import { resetTables } from './helpers.js';

beforeEach(resetTables);
after(() => pool.end());

test('createUser creates a user and returns it, including the stored passwordHash', async () => {
  const user = await usersRepo.createUser({
    email: 'maya@example.com',
    passwordHash: 'hashed-value',
    displayName: 'Maya',
  });

  assert.ok(user.id);
  assert.equal(user.email, 'maya@example.com');
  assert.equal(user.passwordHash, 'hashed-value');
  assert.equal(user.displayName, 'Maya');
});

test('createUser rejects a duplicate email (unique constraint)', async () => {
  await usersRepo.createUser({
    email: 'dup@example.com',
    passwordHash: 'a',
    displayName: 'First',
  });

  await assert.rejects(
    () =>
      usersRepo.createUser({ email: 'dup@example.com', passwordHash: 'b', displayName: 'Second' }),
    /duplicate key value/
  );
});

test('findUserByEmail returns the matching user or null', async () => {
  await usersRepo.createUser({
    email: 'alex@example.com',
    passwordHash: 'a',
    displayName: 'Alex',
  });

  const found = await usersRepo.findUserByEmail('alex@example.com');
  const notFound = await usersRepo.findUserByEmail('nobody@example.com');

  assert.equal(found.displayName, 'Alex');
  assert.equal(notFound, null);
});

test('findUserById returns the matching user or null', async () => {
  const created = await usersRepo.createUser({
    email: 'jordan@example.com',
    passwordHash: 'a',
    displayName: 'Jordan',
  });

  const found = await usersRepo.findUserById(created.id);
  const notFound = await usersRepo.findUserById('00000000-0000-0000-0000-000000000000');

  assert.equal(found.id, created.id);
  assert.equal(notFound, null);
});
