import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import * as documentsApi from '../api/documentsApi.js';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  const loadDocuments = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const docs = await documentsApi.listDocuments();
      setDocuments(docs);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  async function handleCreate() {
    setIsCreating(true);
    setError(null);
    try {
      await documentsApi.createDocument({ title: 'Untitled Document' });
      await loadDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Your documents</h1>
        <div className="dashboard-user">
          <span>{user?.displayName}</span>
          <button type="button" onClick={logout} className="secondary">
            Log out
          </button>
        </div>
      </header>

      <button type="button" onClick={handleCreate} disabled={isCreating}>
        {isCreating ? 'Creating…' : '+ New document'}
      </button>

      {status === 'loading' && <p className="page-status">Loading documents…</p>}
      {status === 'error' && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {status === 'ready' && documents.length === 0 && (
        <p className="page-status">No documents yet. Create one to get started.</p>
      )}
      {status === 'ready' && documents.length > 0 && (
        <ul className="document-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <Link to={`/documents/${doc.id}`}>{doc.title}</Link>
              <span className="document-meta">
                Updated {new Date(doc.updatedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
