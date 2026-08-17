import { pool } from './pool.js';

// Maps a refresh_tokens row to camelCase.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// Stores a hashed refresh token. tokenHash must already be hashed by the
// caller — this layer never sees or stores a plaintext token.
export async function createRefreshToken({ userId, tokenHash, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, tokenHash, expiresAt]
  );
  return mapRow(rows[0]);
}

// Finds a refresh token by its hash. Returns null if no such token exists
// (including if it was already rotated/deleted).
export async function findRefreshTokenByHash(tokenHash) {
  const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [
    tokenHash,
  ]);
  return mapRow(rows[0]) ?? null;
}

// Deletes a refresh token by id — used both for rotation (old token is
// deleted as soon as a new one is issued) and outright revocation.
export async function deleteRefreshToken(id) {
  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [id]);
}
