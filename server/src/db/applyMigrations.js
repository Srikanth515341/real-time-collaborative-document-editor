import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');

// Applies every .sql file in migrations/, in filename order, each inside its own
// transaction, using the given connected pg client. Shared by the dev migration
// runner and the test-database reset script. Tracks applied filenames in a
// schema_migrations table so re-running is a safe no-op for files already applied.
export async function applyMigrations(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename VARCHAR(255) PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const { rows: alreadyApplied } = await client.query('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(alreadyApplied.map((r) => r.filename));

  const names = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  let appliedCount = 0;

  for (const file of names) {
    if (appliedSet.has(file)) {
      logger.info({ file }, 'skipping already-applied migration');
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    logger.info({ file }, 'applying migration');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  return appliedCount;
}
