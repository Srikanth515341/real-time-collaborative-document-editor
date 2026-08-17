const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const REFRESH_TOKEN_KEY = 'collab_editor_refresh_token';

// The access token lives in memory only -- it is never written to
// localStorage/sessionStorage, so it leaves no persistent artifact an XSS
// payload (or anyone with devtools/disk access) could read after the fact.
// It's short-lived (15 min) by design, which limits the cost of losing it on
// a page reload -- restoreSession() re-derives one via the refresh token.
let accessToken = null;
let unauthorizedHandler = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

// Called once by AuthProvider so a failed silent refresh (in
// authenticatedRequest below) can clear React auth state, which causes
// protected routes to redirect to /login.
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

// The refresh token can't be avoided in persistent storage entirely --
// without it, every page reload would force a fresh login. sessionStorage
// (not localStorage) bounds its lifetime to the current tab: it's cleared on
// tab close and never synced across tabs or browser restarts. It's still
// readable by any script running on the page (that's true of any Web Storage
// API, not a sessionStorage-specific weakness) -- the real fix would be an
// httpOnly cookie, which requires backend changes out of this phase's scope.
export function getStoredRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setStoredRefreshToken(token) {
  if (token) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

async function parseJsonOrThrow(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

function buildHeaders(extra) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

// Plain request -- no auto-refresh-on-401. Used for the auth endpoints
// themselves (register/login/refresh), where a 401 is a meaningful "wrong
// credentials" / "invalid token" response to show the user, not a signal
// that an existing session has expired.
export async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return parseJsonOrThrow(response);
}

let refreshPromise = null;

// Coalesces concurrent refresh attempts (e.g. several requests hitting 401
// at once) into a single in-flight refresh call.
function refreshAccessToken() {
  const storedRefreshToken = getStoredRefreshToken();
  if (!storedRefreshToken) {
    return Promise.resolve(false);
  }

  if (!refreshPromise) {
    refreshPromise = request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: storedRefreshToken },
    })
      .then((data) => {
        setAccessToken(data.accessToken);
        setStoredRefreshToken(data.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Authenticated request -- attaches the access token, and on a 401 attempts
// one silent refresh + retry before giving up and notifying the app (which
// clears auth state, causing protected routes to redirect to /login). Used
// for every documents/permissions API call.
export async function authenticatedRequest(path, options = {}) {
  try {
    return await request(path, options);
  } catch (err) {
    if (err.status !== 401) {
      throw err;
    }

    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      setAccessToken(null);
      setStoredRefreshToken(null);
      if (unauthorizedHandler) {
        unauthorizedHandler();
      }
      throw err;
    }
    return request(path, options);
  }
}
