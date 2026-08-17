import { pool } from '../../src/db/pool.js';

// Empties every table between tests so each test starts from a clean slate,
// without needing to re-run migrations. Order doesn't matter since CASCADE
// follows foreign keys automatically.
export async function resetTables() {
  await pool.query(
    'TRUNCATE TABLE refresh_tokens, operation_log, document_snapshots, document_permissions, documents, users RESTART IDENTITY CASCADE'
  );
}

// Test-only convenience: inserts a user directly and returns it, so repo
// tests that need a valid owner_id/user_id don't have to duplicate the
// insert SQL themselves.
export async function insertTestUser({
  email = `user-${Math.random().toString(36).slice(2)}@example.com`,
  passwordHash = 'not-a-real-hash',
  displayName = 'Test User',
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *`,
    [email, passwordHash, displayName]
  );
  return rows[0];
}
