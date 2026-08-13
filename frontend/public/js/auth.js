/* Basic authentication utilities for the ShelterLink frontend */

const TOKEN_STORAGE_KEY = "shelterlink_auth_token";

export function getApiUrl() {
  return (window.SHELTERLINK_CONFIG && window.SHELTERLINK_CONFIG.API_URL) || "";
}

export function setAuthToken(token) {
  if (typeof token !== "string") return;
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function isAuthenticated() {
  return Boolean(getAuthToken());
}

export async function authenticatedFetch(path, options = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = path.startsWith("http") ? path : `${getApiUrl()}${path}`;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    clearAuthToken();
  }
  return response;
}


