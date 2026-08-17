import { pool } from './pool.js';

// Maps an operation_log row to camelCase.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    userId: row.user_id,
    updateData: row.update_data,
    createdAt: row.created_at,
  };
}

// Appends a single Yjs update (a Buffer) to the operation log. userId may be null
// for system-generated operations. Returns the created log entry.
export async function appendOperation({ documentId, userId, updateData }) {
  const { rows } = await pool.query(
    `INSERT INTO operation_log (document_id, user_id, update_data)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [documentId, userId ?? null, updateData]
  );
  return mapRow(rows[0]);
}

// Returns every operation for a document created strictly after sinceTimestamp,
// oldest first — used to replay updates on top of the latest snapshot.
export async function getOperationsSince({ documentId, sinceTimestamp }) {
  const { rows } = await pool.query(
    `SELECT * FROM operation_log
     WHERE document_id = $1 AND created_at > $2
     ORDER BY created_at ASC`,
    [documentId, sinceTimestamp]
  );
  return rows.map(mapRow);
}

// Deletes operation log entries for a document older than the given timestamp.
// Safe to run once a snapshot at or after that timestamp exists, since the
// snapshot plus everything after it is always sufficient to reconstruct state.
export async function pruneOperationsBefore({ documentId, timestamp }) {
  await pool.query('DELETE FROM operation_log WHERE document_id = $1 AND created_at < $2', [
    documentId,
    timestamp,
  ]);
}
