import pg from 'pg';
import { logger } from '../logger.js';
import { applyMigrations } from './applyMigrations.js';

// Drops and recreates the public schema, then re-applies every migration.
// Refuses to run unless DATABASE_URL clearly points at a database named
// something containing "test" — this is destructive and must never be
// pointed at a dev or prod database by accident.
async function main() {
  const connectionString = process.env.DATABASE_URL || '';
  const dbName = new URL(connectionString).pathname.replace(/^\//, '');
  if (!dbName.includes('test')) {
    throw new Error(
      `Refusing to reset database "${dbName}" — resetTestDb.js only runs against a ` +
        `database whose name contains "test". Set DATABASE_URL to your test database.`
    );
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    const count = await applyMigrations(client);
    logger.info({ dbName, count }, 'test database reset and migrated');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'test database reset failed');
  process.exit(1);
});
