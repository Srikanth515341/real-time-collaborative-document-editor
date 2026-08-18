import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useYjsConnection } from '../hooks/useYjsConnection.js';
import * as documentsApi from '../api/documentsApi.js';
import PermissionsPanel from '../components/PermissionsPanel.jsx';
import EditorSurface from '../components/EditorSurface.jsx';

const CONNECTION_LABELS = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Connection lost',
};

export default function DocumentEditorPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [docData, setDocData] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const doc = await documentsApi.getDocument(id);
      setDocData(doc);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Hooks must run unconditionally, so this starts connecting even while
  // the metadata fetch above is still loading -- harmless, and means the
  // editor is ready the instant the metadata is.
  const {
    yDoc,
    connectionStatus,
    canEdit,
    error: syncError,
  } = useYjsConnection(id);

  if (status === 'loading') {
    return <p className="page-status">Loading document…</p>;
  }
  if (status === 'error') {
    return (
      <div className="document-editor-page">
        <Link to="/">&larr; Back to documents</Link>
        <p className="error-message" role="alert">
          {error}
        </p>
      </div>
    );
  }

  const isOwner = docData.ownerId === user?.id;
  // Editing stays enabled through 'connecting'/'reconnecting' -- local
  // edits are always safe (Yjs keeps them regardless of connection state),
  // and useYjsConnection resends the full local state on every successful
  // (re)join, so anything typed during a brief drop still reaches the
  // server once it's back. Only a truly given-up 'disconnected' state (or
  // a real permission denial) blocks typing -- past that point there's no
  // automatic path back to sync, and letting the user keep typing into the
  // void would be misleading.
  const editingDisabled = connectionStatus === 'disconnected' || !canEdit;

  return (
    <div className="document-editor-page">
      <Link to="/">&larr; Back to documents</Link>
      <div className="document-editor-header">
        <h1>{docData.title}</h1>
        <span
          className={`connection-badge connection-badge--${connectionStatus}`}
          role="status"
        >
          {CONNECTION_LABELS[connectionStatus] ?? connectionStatus}
        </span>
      </div>
      <p className="document-meta">Last updated {new Date(docData.updatedAt).toLocaleString()}</p>

      {connectionStatus === 'disconnected' && syncError && (
        <p className="error-message" role="alert">
          {syncError.message}
        </p>
      )}
      {canEdit === false && connectionStatus === 'connected' && (
        <p className="page-status">You have view-only access to this document.</p>
      )}

      <EditorSurface yDoc={yDoc} disabled={editingDisabled} />

      <PermissionsPanel documentId={id} isOwner={isOwner} />
    </div>
  );
}
