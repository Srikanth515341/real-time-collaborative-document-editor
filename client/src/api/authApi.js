import { request, setAccessToken, setStoredRefreshToken } from './httpClient.js';

// Registers a new account and starts a session. Returns the created user.
export async function register({ email, password, displayName }) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
  });
  setAccessToken(data.accessToken);
  setStoredRefreshToken(data.refreshToken);
  return data.user;
}

// Logs in and starts a session. Returns the authenticated user.
export async function login({ email, password }) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  setAccessToken(data.accessToken);
  setStoredRefreshToken(data.refreshToken);
  return data.user;
}

// Redeems a refresh token for a fresh token pair (used on app load to
// silently restore a session). Does not touch stored state itself -- the
// caller decides what to do with the result.
export async function refresh(refreshToken) {
  return request('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
}
