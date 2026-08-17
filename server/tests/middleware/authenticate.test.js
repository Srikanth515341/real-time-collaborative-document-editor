import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../../src/middleware/authenticate.js';
import { sign } from '../../src/utils/jwt.js';

function fakeReq(authorizationHeader) {
  return { headers: authorizationHeader ? { authorization: authorizationHeader } : {} };
}

function callAuthenticate(header) {
  return new Promise((resolve) => {
    const req = fakeReq(header);
    authenticate(req, {}, (err) => resolve({ err, req }));
  });
}

test('a valid token passes: req.user is set and next() is called with no error', async () => {
  const token = sign({ userId: 'user-1', email: 'a@example.com' });

  const { err, req } = await callAuthenticate(`Bearer ${token}`);

  assert.equal(err, undefined);
  assert.deepEqual(req.user, { userId: 'user-1', email: 'a@example.com' });
});

test('a missing Authorization header is rejected with a 401 AuthError', async () => {
  const { err } = await callAuthenticate(undefined);

  assert.ok(err);
  assert.equal(err.statusCode, 401);
});

test('a malformed header (no Bearer prefix) is rejected', async () => {
  const { err } = await callAuthenticate('not-a-bearer-token');

  assert.ok(err);
  assert.equal(err.statusCode, 401);
});

test('an expired token is rejected', async () => {
  const token = sign({ userId: 'user-1' }, { expiresIn: '-1s' });

  const { err } = await callAuthenticate(`Bearer ${token}`);

  assert.ok(err);
  assert.equal(err.statusCode, 401);
});

test('a tampered token is rejected', async () => {
  const token = sign({ userId: 'user-1' });
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');

  const { err } = await callAuthenticate(`Bearer ${tampered}`);

  assert.ok(err);
  assert.equal(err.statusCode, 401);
});
