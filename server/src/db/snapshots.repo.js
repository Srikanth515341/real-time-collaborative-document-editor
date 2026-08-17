import { pool } from './pool.js';

// Maps a document_snapshots row to camelCase.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    snapshotData: row.snapshot_data,
    versionLabel: row.version_label,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

// Persists a full document-state snapshot (a Buffer of Y.encodeStateAsUpdate output).
// versionLabel and createdBy are optional. Returns the created Snapshot.
export async function saveSnapshot({ documentId, snapshotData, versionLabel, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO document_snapshots (document_id, snapshot_data, version_label, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [documentId, snapshotData, versionLabel ?? null, createdBy ?? null]
  );
  return mapRow(rows[0]);
}

// Returns the most recently created snapshot for a document, or null if none exist.
export async function getLatestSnapshot(documentId) {
  const { rows } = await pool.query(
    `SELECT * FROM document_snapshots
     WHERE document_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId]
  );
  return mapRow(rows[0]) ?? null;
}

// Lists every snapshot for a document, newest first.
export async function listSnapshots(documentId) {
  const { rows } = await pool.query(
    'SELECT * FROM document_snapshots WHERE document_id = $1 ORDER BY created_at DESC',
    [documentId]
  );
  return rows.map(mapRow);
}
