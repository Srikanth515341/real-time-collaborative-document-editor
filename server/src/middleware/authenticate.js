import { verify } from '../utils/jwt.js';
import { AuthError } from '../utils/errors.js';

// Verifies the Authorization: Bearer <token> header and attaches the decoded
// user to req.user. Rejects with 401 (via errorHandler) on any missing,
// malformed, or invalid/expired token — never trusts anything the client
// claims about its own identity.
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AuthError('Missing or malformed Authorization header.'));
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return next(new AuthError('Missing or malformed Authorization header.'));
  }

  try {
    const decoded = verify(token);
    req.user = { userId: decoded.userId, email: decoded.email };
    next();
  } catch {
    next(new AuthError('Invalid or expired token.'));
  }
}
