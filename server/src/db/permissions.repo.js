import { pool } from './pool.js';

// Maps a document_permissions row to camelCase.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    userId: row.user_id,
    role: row.role,
    grantedAt: row.granted_at,
  };
}

// Grants (or updates) a user's role on a document. Upserts on the
// (document_id, user_id) unique constraint so re-granting changes the role
// instead of erroring. Returns the resulting permission row. Accepts an
// optional trailing `client` (defaulting to the shared pool) so
// documentService.createNewDocument can run this inside the same transaction
// as the document creation.
export async function grantPermission({ documentId, userId, role }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO document_permissions (document_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id)
     DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [documentId, userId, role]
  );
  return mapRow(rows[0]);
}

// Removes a user's access to a document entirely.
export async function revokePermission({ documentId, userId }) {
  await pool.query('DELETE FROM document_permissions WHERE document_id = $1 AND user_id = $2', [
    documentId,
    userId,
  ]);
}

// Returns the user's role on the document ('owner' | 'editor' | 'viewer'), or null
// if they have no access.
export async function getUserRole({ documentId, userId }) {
  const { rows } = await pool.query(
    'SELECT role FROM document_permissions WHERE document_id = $1 AND user_id = $2',
    [documentId, userId]
  );
  return rows[0]?.role ?? null;
}

// Lists every permission grant for a document.
export async function listPermissionsForDocument(documentId) {
  const { rows } = await pool.query(
    'SELECT * FROM document_permissions WHERE document_id = $1 ORDER BY granted_at ASC',
    [documentId]
  );
  return rows.map(mapRow);
}
