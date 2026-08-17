import { Router } from 'express';
import * as usersRepo from '../db/users.repo.js';
import * as authService from '../services/authService.js';
import { ValidationError, AuthError, ConflictError } from '../utils/errors.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function toPublicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body ?? {};

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      throw new ValidationError('A valid email is required.');
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (typeof displayName !== 'string' || displayName.trim().length === 0) {
      throw new ValidationError('A display name is required.');
    }

    const existing = await usersRepo.findUserByEmail(email);
    if (existing) {
      throw new ConflictError('An account with that email already exists.');
    }

    const passwordHash = await authService.hashPassword(password);
    let user;
    try {
      user = await usersRepo.createUser({ email, passwordHash, displayName: displayName.trim() });
    } catch (err) {
      // Defense-in-depth against the race where two concurrent registrations
      // for the same email both pass the findUserByEmail check above before
      // either INSERT completes — the unique constraint is the real guard.
      if (err.code === '23505') {
        throw new ConflictError('An account with that email already exists.');
      }
      throw err;
    }
    const tokens = await authService.issueTokenPair({ userId: user.id, email: user.email });

    res.status(201).json({ user: toPublicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new AuthError('Invalid email or password.');
    }

    const user = await usersRepo.findUserByEmail(email);
    // verifyPassword always runs a real bcrypt comparison, even when user is
    // null, so a nonexistent email and a wrong password take the same time
    // and return the exact same error — never revealing which one it was.
    const isValid = await authService.verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !isValid) {
      throw new AuthError('Invalid email or password.');
    }

    const tokens = await authService.issueTokenPair({ userId: user.id, email: user.email });
    res.status(200).json({ user: toPublicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body ?? {};

    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new AuthError('Invalid or expired refresh token.');
    }

    const tokens = await authService.rotateRefreshToken(refreshToken);
    res.status(200).json(tokens);
  } catch (err) {
    next(err);
  }
});

export default router;
