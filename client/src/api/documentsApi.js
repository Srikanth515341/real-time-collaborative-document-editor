import { authenticatedRequest } from './httpClient.js';

export function listDocuments() {
  return authenticatedRequest('/api/documents');
}

export function createDocument({ title }) {
  return authenticatedRequest('/api/documents', { method: 'POST', body: { title } });
}

export function getDocument(id) {
  return authenticatedRequest(`/api/documents/${id}`);
}

export function updateDocument(id, updates) {
  return authenticatedRequest(`/api/documents/${id}`, { method: 'PATCH', body: updates });
}

export function deleteDocument(id) {
  return authenticatedRequest(`/api/documents/${id}`, { method: 'DELETE' });
}

export function listVersions(id) {
  return authenticatedRequest(`/api/documents/${id}/versions`);
}

export function listPermissions(id) {
  return authenticatedRequest(`/api/documents/${id}/permissions`);
}

export function grantPermission(id, { email, role }) {
  return authenticatedRequest(`/api/documents/${id}/permissions`, {
    method: 'POST',
    body: { email, role },
  });
}

export function revokePermission(id, userId) {
  return authenticatedRequest(`/api/documents/${id}/permissions/${userId}`, { method: 'DELETE' });
}
