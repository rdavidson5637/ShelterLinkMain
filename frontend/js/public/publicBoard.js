// Keep in sync with utils/publicOpportunityFilter.js
export const HIDDEN_PUBLIC_TITLE = /smoke|test|runthrough/i;
const HIDDEN_STATUSES = new Set(['cancelled', 'closed', 'completed']);

export function isHiddenFromPublicBoard(opp) {
  const status = String(opp?.status || '').toLowerCase();
  if (HIDDEN_STATUSES.has(status)) return true;
  if (HIDDEN_PUBLIC_TITLE.test(String(opp?.title || ''))) return true;
  return false;
}

export function filterPublicBoard(rows) {
  return (Array.isArray(rows) ? rows : []).filter((opp) => !isHiddenFromPublicBoard(opp));
}

export function isAcceptingSignups(opp) {
  if (!opp || isHiddenFromPublicBoard(opp)) return false;
  if (opp.accepting_applications === false) return false;
  if (opp.spots_remaining === 0) return false;
  return true;
}

export function closedShiftLabel(opp) {
  const status = String(opp?.status || '').toLowerCase();
  if (status === 'cancelled') return 'This shift was cancelled';
  if (status === 'closed') return 'This shift is closed';
  return 'Shift full';
}
