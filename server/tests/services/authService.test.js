import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { config } from '../../src/config.js';
import * as authService from '../../src/services/authService.js';
import * as refreshTokensRepo from '../../src/db/refreshTokens.repo.js';
import { resetTables, insertTestUser } from '../db/helpers.js';

beforeEach(resetTables);
after(() => pool.end());

test('hashPassword produces a hash that verifyPassword accepts for the same password', async () => {
  const hash = await authService.hashPassword('correct horse battery staple');

  assert.equal(await authService.verifyPassword('correct horse battery staple', hash), true);
});

test('verifyPassword rejects an incorrect password', async () => {
  const hash = await authService.hashPassword('correct horse battery staple');

  assert.equal(await authService.verifyPassword('wrong password', hash), false);
});

test('verifyPassword rejects when passwordHash is null (nonexistent user), without throwing', async () => {
  assert.equal(await authService.verifyPassword('anything', null), false);
});

test('issueTokenPair returns a valid signed access token and an opaque refresh token', async () => {
  const user = await insertTestUser({ email: 'issue@example.com' });

  const tokens = await authService.issueTokenPair({ userId: user.id, email: user.email });

  assert.ok(typeof tokens.accessToken === 'string');
  assert.ok(typeof tokens.refreshToken === 'string');

  const decoded = jwt.verify(tokens.accessToken, config.jwt.accessSecret);
  assert.equal(decoded.userId, user.id);
  assert.equal(decoded.email, user.email);
});

test('issueTokenPair stores the refresh token hashed, not in plaintext', async () => {
  const user = await insertTestUser({ email: 'hashed@example.com' });

  const { refreshToken } = await authService.issueTokenPair({
    userId: user.id,
    email: user.email,
  });

  const { rows } = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [
    user.id,
  ]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, refreshToken);
});

test('rotateRefreshToken issues a new pair and invalidates the old refresh token', async () => {
  const user = await insertTestUser({ email: 'rotate@example.com' });
  const first = await authService.issueTokenPair({ userId: user.id, email: user.email });

  const rotated = await authService.rotateRefreshToken(first.refreshToken);

  assert.notEqual(rotated.refreshToken, first.refreshToken);
  await assert.rejects(() => authService.rotateRefreshToken(first.refreshToken));
});

test('rotateRefreshToken rejects an unknown token', async () => {
  await assert.rejects(() => authService.rotateRefreshToken('not-a-real-token'));
});

test('rotateRefreshToken rejects an expired token', async () => {
  const user = await insertTestUser({ email: 'expired@example.com' });
  const rawToken = 'expired-raw-token-value';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await refreshTokensRepo.createRefreshToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() - 1000),
  });

  await assert.rejects(() => authService.rotateRefreshToken(rawToken));
});
