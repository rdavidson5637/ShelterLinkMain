/**
 * Which API status codes should bounce the whole page to /pages/error/*.
 * 404/503 are normal empty states (missing profile, closed shift detail).
 */
export function shouldRedirectStatus(status) {
  if (status === 404 || status === 503) return false;
  return status === 403 || (Number(status) >= 500 && Number(status) < 600);
}
