import pg from 'pg';

// Shared connection pool used by every repo module.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
