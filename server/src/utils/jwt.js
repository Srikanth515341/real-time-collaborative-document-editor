import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// Signs a payload as an access token using config.jwt.accessSecret. Accepts an
// optional secret/expiresIn override (e.g. for a future refresh-token variant)
// but defaults to the standard access-token settings.
export function sign(payload, { secret = config.jwt.accessSecret, expiresIn } = {}) {
  return jwt.sign(payload, secret, { expiresIn: expiresIn || config.jwt.accessExpiresIn });
}

// Verifies a token signed by sign(); throws if it's invalid, expired, or
// tampered with. Accepts the same optional secret override as sign().
export function verify(token, { secret = config.jwt.accessSecret } = {}) {
  return jwt.verify(token, secret);
}
