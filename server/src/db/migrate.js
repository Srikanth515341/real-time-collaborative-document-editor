import 'dotenv/config';
import pg from 'pg';
import { logger } from '../logger.js';
import { applyMigrations } from './applyMigrations.js';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const count = await applyMigrations(client);
    logger.info({ count }, 'migrations complete');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
