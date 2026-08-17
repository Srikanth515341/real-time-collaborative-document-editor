import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

// Wraps a page element; redirects to /login if the user isn't authenticated.
// Shows a loading state while the initial session-restore check is running,
// so an unauthenticated flash never appears for a user who is actually
// still logged in (their refresh token is just being redeemed).
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="page-status">Loading…</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
