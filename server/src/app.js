import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';

// Builds and configures the Express application (kept separate from index.js
// so tests can import the app without starting the HTTP listener).
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    })
  );
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
