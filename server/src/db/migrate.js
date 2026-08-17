import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { applyMigrations } from './applyMigrations.js';

async function main() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
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
