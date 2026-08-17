import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import * as documentsApi from '../api/documentsApi.js';
import PermissionsPanel from '../components/PermissionsPanel.jsx';

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

  return (
    <div className="document-editor-page">
      <Link to="/">&larr; Back to documents</Link>
      <h1>{docData.title}</h1>
      <p className="document-meta">Last updated {new Date(docData.updatedAt).toLocaleString()}</p>

      <div className="editor-placeholder">
        <p>The real-time collaborative editor will live here starting in Phase 8.</p>
      </div>

      <PermissionsPanel documentId={id} isOwner={isOwner} />
    </div>
  );
}
