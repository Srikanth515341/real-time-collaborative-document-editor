import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Preloaded via `node --import` before any test file (and therefore before
// pool.js) is loaded, so DATABASE_URL is already pointed at the test database
// by the time repo modules read it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
