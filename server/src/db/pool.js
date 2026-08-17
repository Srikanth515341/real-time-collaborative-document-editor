import pg from 'pg';
import { config } from '../config.js';

// Shared connection pool used by every repo module.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
