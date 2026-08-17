import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../src/utils/jwt.js';

test('sign then verify round-trips the original payload', () => {
  const token = sign({ userId: 'abc-123', email: 'maya@example.com' });

  const decoded = verify(token);

  assert.equal(decoded.userId, 'abc-123');
  assert.equal(decoded.email, 'maya@example.com');
});

test('verify rejects a tampered token', () => {
  const token = sign({ userId: 'abc-123' });
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');

  assert.throws(() => verify(tampered));
});

test('verify rejects a token signed with a different secret', () => {
  const token = sign({ userId: 'abc-123' }, { secret: 'a-completely-different-secret' });

  assert.throws(() => verify(token));
});
