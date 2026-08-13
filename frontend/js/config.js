// Dynamically resolve API base URL so the app works on localhost AND any deployed host.
// In production (Railway, Render, etc.) window.location.origin will be the real domain.
export const API_URL = `${window.location.origin}/api`;

export function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

  const fetchOptions = { credentials: 'include', ...options };

  if (fetchOptions.body !== undefined && fetchOptions.body !== null) {
    const headers = new Headers(fetchOptions.headers || {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    fetchOptions.headers = headers;
    if (typeof fetchOptions.body !== 'string') {
      fetchOptions.body = JSON.stringify(fetchOptions.body);
    }
  }

  return fetch(url, fetchOptions);
}
