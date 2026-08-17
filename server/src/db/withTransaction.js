import { pool } from './pool.js';

// Runs fn with a single checked-out client wrapped in BEGIN/COMMIT (or
// ROLLBACK on error), so multiple repo calls inside fn can participate in one
// atomic transaction. Repo functions that need to be transaction-aware accept
// an optional trailing `client` param (defaulting to the shared pool), which
// is what gets passed through here.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
