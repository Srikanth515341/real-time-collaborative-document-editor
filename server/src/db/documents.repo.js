import { pool } from './pool.js';

// Maps a documents table row to the camelCase Document shape used by the rest of the app.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isArchived: row.is_archived,
  };
}

// Inserts a new document row owned by ownerId. Returns the created Document.
export async function createDocument({ ownerId, title }) {
  const { rows } = await pool.query(
    `INSERT INTO documents (owner_id, title)
     VALUES ($1, COALESCE($2, 'Untitled Document'))
     RETURNING *`,
    [ownerId, title ?? null]
  );
  return mapRow(rows[0]);
}

// Fetches a single document by id. Returns null if it doesn't exist.
export async function getDocumentById(documentId) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [documentId]);
  return mapRow(rows[0]) ?? null;
}

// Lists every document the given user owns or has been granted access to.
export async function listDocumentsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT d.*
     FROM documents d
     JOIN document_permissions p ON p.document_id = d.id
     WHERE p.user_id = $1
     ORDER BY d.updated_at DESC`,
    [userId]
  );
  return rows.map(mapRow);
}

// Updates the given document's title and/or archived flag; leaves unspecified fields
// unchanged. Returns the updated Document, or null if it doesn't exist.
export async function updateDocument(documentId, { title, isArchived } = {}) {
  const { rows } = await pool.query(
    `UPDATE documents
     SET title = COALESCE($2, title),
         is_archived = COALESCE($3, is_archived),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [documentId, title ?? null, isArchived ?? null]
  );
  return mapRow(rows[0]) ?? null;
}

// Deletes a document (and, via ON DELETE CASCADE, its permissions, snapshots, and
// operation log entries).
export async function deleteDocument(documentId) {
  await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);
}
