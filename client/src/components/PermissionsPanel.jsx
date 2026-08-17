import { useCallback, useEffect, useState } from 'react';
import * as documentsApi from '../api/documentsApi.js';

// Only rendered content for the document owner -- the backend rejects
// list/grant/revoke with 403 for anyone else, so this never even attempts
// the request otherwise.
export default function PermissionsPanel({ documentId, isOwner }) {
  const [grants, setGrants] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const list = await documentsApi.listPermissions(documentId);
      setGrants(list);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [documentId]);

  useEffect(() => {
    if (isOwner) {
      load();
    }
  }, [isOwner, load]);

  if (!isOwner) {
    return null;
  }

  async function handleGrant(event) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await documentsApi.grantPermission(documentId, { email, role });
      setEmail('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevoke(userId) {
    setError(null);
    try {
      await documentsApi.revokePermission(documentId, userId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="permissions-panel">
      <h2>Access</h2>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {status === 'loading' && <p className="page-status">Loading access list…</p>}
      {status === 'ready' && (
        <ul className="permission-list">
          {grants.map((grant) => (
            <li key={grant.id}>
              <span className="permission-user">{grant.userId}</span>
              <span className="permission-role">{grant.role}</span>
              {grant.role !== 'owner' && (
                <button type="button" className="secondary" onClick={() => handleRevoke(grant.userId)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleGrant} className="grant-form">
        <input
          type="email"
          placeholder="Email to grant access"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Granting…' : 'Grant access'}
        </button>
      </form>
    </section>
  );
}
