// Holds a scanned poster check-in across the sign-in redirect, so a volunteer
// who scans while signed out lands back on the check-in page afterwards.
// Session storage only: it is cleared on sign-out and never leaves the tab.

const KEY = 'pending_checkin';
const PAGE = '/pages/volunteer/checkin.html';

function cleanShift(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{1,20}$/.test(code) ? code : '';
}

export function savePendingCheckin(shift, code) {
  const id = cleanShift(shift);
  if (!id) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ shift: id, code: cleanCode(code) }));
  } catch (_) {
    /* storage unavailable: the volunteer can scan again */
  }
}

export function takePendingCheckin() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const shift = cleanShift(parsed?.shift);
    return shift ? { shift, code: cleanCode(parsed?.code) } : null;
  } catch (_) {
    return null;
  }
}

/** Same-origin check-in page path for a pending scan, or null. Does not clear it. */
export function pendingCheckinPath() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    const shift = cleanShift(parsed?.shift);
    return shift ? `${PAGE}?shift=${shift}` : null;
  } catch (_) {
    return null;
  }
}

export { cleanShift, cleanCode };
