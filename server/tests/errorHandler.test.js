import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Builds a throwaway app (not the real one) that deliberately throws, so we
// can verify errorHandler's behavior without adding a permanent debug route
// to the real app.
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.get('/boom', () => {
    throw new Error('sensitive internal detail that must not leak');
  });
  app.get('/known-error', () => {
    const err = new Error('Document not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  });
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('an unexpected thrown error results in a safe, generic 500 response', async () => {
  const res = await fetch(`${baseUrl}/boom`);
  const body = await res.json();

  assert.equal(res.status, 500);
  assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } });
  assert.ok(!JSON.stringify(body).includes('sensitive internal detail'));
});

test('an error with statusCode/code below 500 passes its own message through', async () => {
  const res = await fetch(`${baseUrl}/known-error`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.deepEqual(body, { error: { code: 'NOT_FOUND', message: 'Document not found' } });
});
