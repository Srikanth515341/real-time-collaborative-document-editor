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

function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/auth/register creates a user and returns tokens', async () => {
  const res = await postJson('/api/auth/register', {
    email: 'maya@example.com',
    password: 'correct horse battery staple',
    displayName: 'Maya',
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.user.email, 'maya@example.com');
  assert.equal(body.user.displayName, 'Maya');
  assert.equal(body.user.passwordHash, undefined);
  assert.ok(body.accessToken);
  assert.ok(body.refreshToken);
});

test('POST /api/auth/register rejects a weak password with 400', async () => {
  const res = await postJson('/api/auth/register', {
    email: 'weak@example.com',
    password: 'short',
    displayName: 'Weak',
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/auth/register rejects a duplicate email with 409', async () => {
  await postJson('/api/auth/register', {
    email: 'dup@example.com',
    password: 'correct horse battery staple',
    displayName: 'First',
  });

  const res = await postJson('/api/auth/register', {
    email: 'dup@example.com',
    password: 'another good password',
    displayName: 'Second',
  });
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.error.code, 'CONFLICT');
});

test('POST /api/auth/login succeeds with correct credentials', async () => {
  await postJson('/api/auth/register', {
    email: 'login@example.com',
    password: 'correct horse battery staple',
    displayName: 'Login',
  });

  const res = await postJson('/api/auth/login', {
    email: 'login@example.com',
    password: 'correct horse battery staple',
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.accessToken);
  assert.ok(body.refreshToken);
});

test('POST /api/auth/login returns the identical error for wrong password and unknown email', async () => {
  await postJson('/api/auth/register', {
    email: 'known@example.com',
    password: 'correct horse battery staple',
    displayName: 'Known',
  });

  const wrongPasswordRes = await postJson('/api/auth/login', {
    email: 'known@example.com',
    password: 'totally wrong password',
  });
  const unknownEmailRes = await postJson('/api/auth/login', {
    email: 'nobody@example.com',
    password: 'whatever password',
  });

  assert.equal(wrongPasswordRes.status, 401);
  assert.equal(unknownEmailRes.status, 401);
  assert.deepEqual(await wrongPasswordRes.json(), await unknownEmailRes.json());
});

test('POST /api/auth/refresh rotates the token and rejects reuse of the old one', async () => {
  const registerRes = await postJson('/api/auth/register', {
    email: 'rotate@example.com',
    password: 'correct horse battery staple',
    displayName: 'Rotate',
  });
  const { refreshToken } = await registerRes.json();

  const refreshRes = await postJson('/api/auth/refresh', { refreshToken });
  const refreshBody = await refreshRes.json();
  assert.equal(refreshRes.status, 200);
  assert.notEqual(refreshBody.refreshToken, refreshToken);

  const reuseRes = await postJson('/api/auth/refresh', { refreshToken });
  assert.equal(reuseRes.status, 401);
});

test('POST /api/auth/refresh rejects a garbage token with 401, not a 500', async () => {
  const res = await postJson('/api/auth/refresh', { refreshToken: 'not-a-real-token' });
  assert.equal(res.status, 401);
});
