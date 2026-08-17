import { pool } from './pool.js';

// Maps a users row to camelCase. Includes passwordHash since the auth service
// (a later phase) needs it to verify logins — callers must never log this field.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

// Creates a new user. passwordHash must already be hashed by the caller — this
// layer does no hashing itself. Returns the created User.
export async function createUser({ email, passwordHash, displayName }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [email, passwordHash, displayName]
  );
  return mapRow(rows[0]);
}

// Finds a user by email (case-sensitive, matching the column's exact stored value).
// Returns null if no such user exists.
export async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return mapRow(rows[0]) ?? null;
}

// Finds a user by id. Returns null if no such user exists.
export async function findUserById(userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return mapRow(rows[0]) ?? null;
}
