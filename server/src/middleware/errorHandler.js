import { logger } from '../utils/logger.js';

// Centralized Express error handler (must be mounted last). Logs the full
// error server-side, but only ever returns a safe, consistent JSON shape to
// the client — never a stack trace or other internal detail.
// Errors may optionally carry `statusCode` and `code` to control the
// response (e.g. a PermissionError thrown by a service in a later phase);
// anything else is treated as an unexpected 500.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = statusCode < 500 ? err.message : 'Internal Server Error';

  logger.error({ err, statusCode, code, path: req.path, method: req.method }, 'request error');

  res.status(statusCode).json({ error: { code, message } });
}
