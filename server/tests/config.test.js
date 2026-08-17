import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../src/config.js');

const VALID_ENV = {
  PATH: process.env.PATH,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  CORS_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

// Runs config.js in a fresh child process (so its top-level, import-time
// validation actually executes) with the given env, in a cwd with no .env
// file so dotenv can't silently backfill a var we're deliberately omitting.
function runConfigWith(env) {
  return spawnSync(process.execPath, [configPath], {
    cwd: os.tmpdir(),
    env,
    encoding: 'utf8',
  });
}

test('config.js loads successfully when every required var is present', () => {
  const result = runConfigWith(VALID_ENV);
  assert.equal(result.status, 0, result.stderr);
});

test('config.js throws a clear error and exits non-zero when a required var is missing', () => {
  const { JWT_ACCESS_SECRET: _omit, ...incompleteEnv } = VALID_ENV;

  const result = runConfigWith(incompleteEnv);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required environment variable: JWT_ACCESS_SECRET/);
});
