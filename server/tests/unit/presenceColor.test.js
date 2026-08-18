import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getColorForUser } from '../../src/utils/presenceColor.js';

test('the same userId always maps to the same color', () => {
  const userId = '77ce1234-0000-4000-8000-000000000001';
  const first = getColorForUser(userId);
  const second = getColorForUser(userId);
  assert.equal(first, second);
});

test('different userIds are distributed across the palette, not collapsed onto one color', () => {
  const userIds = Array.from({ length: 20 }, (_, i) => `user-${i}`);
  const colors = new Set(userIds.map(getColorForUser));
  assert.ok(colors.size > 1, 'expected more than one distinct color across 20 different users');
});

test('every returned color is a valid hex color string', () => {
  const color = getColorForUser('some-user-id');
  assert.match(color, /^#[0-9A-Fa-f]{6}$/);
});
