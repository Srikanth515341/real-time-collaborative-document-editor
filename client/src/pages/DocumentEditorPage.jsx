import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useYjsConnection } from '../hooks/useYjsConnection.js';
import * as documentsApi from '../api/documentsApi.js';
import PermissionsPanel from '../components/PermissionsPanel.jsx';
import EditorSurface from '../components/EditorSurface.jsx';
import PresenceBar from '../components/PresenceBar.jsx';
import RemoteCursors from '../components/RemoteCursors.jsx';

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
    participants,
    sendAwareness,
  } = useYjsConnection(id);

  // Shared with RemoteCursors so it measures against the exact DOM node
  // EditorSurface renders text into.
  const editorContainerRef = useRef(null);

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

  // Excludes the CURRENT user's own id from the presence/cursor data, so
  // opening the same document as yourself in a second tab (or React
  // StrictMode's dev-only double-mount momentarily opening a second socket)
  // never renders "yourself" back as if you were a separate remote
  // collaborator -- the server broadcasts user-joined/awareness-update to
  // every OTHER connection in the room, which includes a second connection
  // for the same person if one exists, so this has to be filtered here.
  const otherParticipants = { ...participants };
  if (user) delete otherParticipants[user.id];

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

      <PresenceBar participants={otherParticipants} currentUser={user} />

      {connectionStatus === 'disconnected' && syncError && (
        <p className="error-message" role="alert">
          {syncError.message}
        </p>
      )}
      {canEdit === false && connectionStatus === 'connected' && (
        <p className="page-status">You have view-only access to this document.</p>
      )}

      <div className="editor-surface-wrapper">
        <EditorSurface
          ref={editorContainerRef}
          yDoc={yDoc}
          disabled={editingDisabled}
          onAwarenessChange={sendAwareness}
        />
        <RemoteCursors containerRef={editorContainerRef} yDoc={yDoc} participants={otherParticipants} />
      </div>

      <PermissionsPanel documentId={id} isOwner={isOwner} />
    </div>
  );
}
