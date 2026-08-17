import pino from 'pino';
import { config } from '../config.js';

// Shared structured logger instance used across the server. No part of the
// codebase should use console.log — import this instead.
export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
