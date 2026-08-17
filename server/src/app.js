import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { pool } from './db/pool.js';
import { errorHandler } from './middleware/errorHandler.js';

// Builds and configures the Express application (kept separate from index.js
// so tests can import the app without starting the HTTP listener).
export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get('/healthz', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok', db: 'ok' });
    } catch (err) {
      logger.error({ err }, 'healthz db check failed');
      res.status(503).json({ status: 'ok', db: 'error' });
    }
  });

  // Must be mounted last so it catches errors from every route above it.
  app.use(errorHandler);

  return app;
}
