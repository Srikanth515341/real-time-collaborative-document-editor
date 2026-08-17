import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfiesRole } from '../../src/services/permissionService.js';

test('an owner satisfies every required role', () => {
  assert.equal(satisfiesRole('owner', 'owner'), true);
  assert.equal(satisfiesRole('owner', 'editor'), true);
  assert.equal(satisfiesRole('owner', 'viewer'), true);
});

test('an editor satisfies editor/viewer but not owner', () => {
  assert.equal(satisfiesRole('editor', 'owner'), false);
  assert.equal(satisfiesRole('editor', 'editor'), true);
  assert.equal(satisfiesRole('editor', 'viewer'), true);
});

test('a viewer satisfies only viewer', () => {
  assert.equal(satisfiesRole('viewer', 'owner'), false);
  assert.equal(satisfiesRole('viewer', 'editor'), false);
  assert.equal(satisfiesRole('viewer', 'viewer'), true);
});

test('no role (null/undefined) never satisfies any requirement', () => {
  assert.equal(satisfiesRole(null, 'viewer'), false);
  assert.equal(satisfiesRole(undefined, 'viewer'), false);
});
