import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as authApi from '../api/authApi.js';
import {
  setAccessToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
  setUnauthorizedHandler,
} from '../api/httpClient.js';

// Not a credential -- just cached display info (id/email/displayName) so a
// page reload can show who's logged in immediately, before the silent
// refresh (which re-derives the access token) even completes.
const USER_STORAGE_KEY = 'collab_editor_user';

function getStoredUser() {
  const raw = sessionStorage.getItem(USER_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setStoredUser(user) {
  if (user) {
    sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(USER_STORAGE_KEY);
  }
}

const AuthContext = createContext(null);

// This file is kept as plain .js (not .jsx) to match the path given for this
// phase, so it uses createElement instead of JSX syntax below.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated'

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setStoredRefreshToken(null);
    setStoredUser(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
  }, [clearSession]);

  // On first load, try to silently restore a session using the refresh
  // token + cached profile in sessionStorage. The access token itself is
  // never persisted, so a reload always loses it -- this re-derives a fresh
  // one via /api/auth/refresh (which also rotates the refresh token).
  //
  // hasStartedRestore guards against React 18 StrictMode's dev-only double
  // effect invocation: refresh tokens are single-use (rotating), so firing
  // this twice on mount is not idempotent -- the second call would present
  // a token the first call already consumed, fail with "invalid refresh
  // token", and incorrectly clear a session that actually restored fine.
  const hasStartedRestore = useRef(false);

  useEffect(() => {
    if (hasStartedRestore.current) return;
    hasStartedRestore.current = true;

    async function restore() {
      const storedRefreshToken = getStoredRefreshToken();
      const storedUser = getStoredUser();
      if (!storedRefreshToken || !storedUser) {
        setStatus('unauthenticated');
        return;
      }
      try {
        const data = await authApi.refresh(storedRefreshToken);
        setAccessToken(data.accessToken);
        setStoredRefreshToken(data.refreshToken);
        setUser(storedUser);
        setStatus('authenticated');
      } catch {
        clearSession();
      }
    }

    restore();
  }, [clearSession]);

  const login = useCallback(async ({ email, password }) => {
    const loggedInUser = await authApi.login({ email, password });
    setStoredUser(loggedInUser);
    setUser(loggedInUser);
    setStatus('authenticated');
    return loggedInUser;
  }, []);

  const register = useCallback(async ({ email, password, displayName }) => {
    const newUser = await authApi.register({ email, password, displayName });
    setStoredUser(newUser);
    setUser(newUser);
    setStatus('authenticated');
    return newUser;
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const value = {
    user,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    login,
    register,
    logout,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
