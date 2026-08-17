import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { sign } from '../utils/jwt.js';
import { config } from '../config.js';
import * as refreshTokensRepo from '../db/refreshTokens.repo.js';
import * as usersRepo from '../db/users.repo.js';
import { AuthError } from '../utils/errors.js';

// 12 is bcrypt's current widely-recommended cost factor for interactive login
// flows: strong enough to resist realistic offline brute-force, while still
// completing in well under 200ms on typical server hardware.
const BCRYPT_COST_FACTOR = 12;

// A fixed dummy hash, computed once at startup, used to keep bcrypt.compare's
// timing consistent even when no user was found (see verifyPassword below).
const DUMMY_HASH = await bcrypt.hash(
  'dummy-password-used-only-to-equalize-timing',
  BCRYPT_COST_FACTOR
);

const REFRESH_TOKEN_BYTES = 64;

// Hashes a plaintext password for storage. Never log the input or the output.
export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

// Verifies a plaintext password against a stored hash. Pass null for
// passwordHash when no user was found — this still runs a real bcrypt.compare
// (against a fixed dummy hash) so a nonexistent email doesn't respond faster
// than a wrong password would, which would otherwise leak account existence
// via timing.
export async function verifyPassword(password, passwordHash) {
  const isMatch = await bcrypt.compare(password, passwordHash ?? DUMMY_HASH);
  return passwordHash !== null && isMatch;
}

// Turns a simple "<number><s|m|h|d>" duration string (matching the
// JWT_*_EXPIRES_IN env var format) into milliseconds.
function parseDurationMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error(`Invalid duration string: ${duration}`);
  }
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * unitMs[match[2]];
}

function hashToken(rawToken) {
  // Refresh tokens are already high-entropy random values, not user-chosen
  // secrets, so a fast deterministic hash (SHA-256) is the right tool here —
  // unlike passwords they don't need bcrypt's slow, salted hashing, and a
  // deterministic hash lets us look one up directly by value.
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Issues a new access token (JWT, short-lived) and refresh token (opaque
// random value, long-lived). The refresh token is stored hashed in the
// database; only this one response ever carries it in plaintext.
export async function issueTokenPair({ userId, email }) {
  const accessToken = sign({ userId, email });

  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + parseDurationMs(config.jwt.refreshExpiresIn));
  await refreshTokensRepo.createRefreshToken({ userId, tokenHash, expiresAt });

  return { accessToken, refreshToken };
}

// Redeems a refresh token for a new token pair, rotating it: the presented
// token is deleted as soon as it's used, so it can never be replayed.
// Throws AuthError if the token is unknown, already used, or expired.
export async function rotateRefreshToken(presentedToken) {
  const tokenHash = hashToken(presentedToken);
  const existing = await refreshTokensRepo.findRefreshTokenByHash(tokenHash);

  if (!existing) {
    throw new AuthError('Invalid or expired refresh token.');
  }
  await refreshTokensRepo.deleteRefreshToken(existing.id);

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new AuthError('Invalid or expired refresh token.');
  }

  const user = await usersRepo.findUserById(existing.userId);
  if (!user) {
    throw new AuthError('Invalid or expired refresh token.');
  }

  return issueTokenPair({ userId: user.id, email: user.email });
}
