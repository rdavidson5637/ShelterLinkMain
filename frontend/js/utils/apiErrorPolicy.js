/**
 * Which API status codes should bounce the whole page to /pages/error/*.
 * 404/503 are normal empty states (missing profile, closed shift detail).
 * A 403 that explains itself (a missing check, a waiver, a qualification)
 * stays on the page. A bare "Forbidden" is still an auth failure.
 */
export function shouldRedirectStatus(status, message) {
  if (status === 404 || status === 503) return false;
  if (status === 403) {
    const text = message == null ? '' : String(message).trim();
    if (text && text.toLowerCase() !== 'forbidden') return false;
    return true;
  }
  return Number(status) >= 500 && Number(status) < 600;
}
