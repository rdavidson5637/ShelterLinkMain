'use strict';

// Keep in sync with frontend/js/public/publicBoard.js
const HIDDEN_PUBLIC_TITLE = /smoke|test|runthrough/i;
const HIDDEN_STATUSES = new Set(['cancelled', 'closed', 'completed']);

function isHiddenFromPublicBoard(opp) {
  const status = String(opp?.status || '').toLowerCase();
  if (HIDDEN_STATUSES.has(status)) return true;
  if (HIDDEN_PUBLIC_TITLE.test(String(opp?.title || ''))) return true;
  return false;
}

function filterPublicBoardOpportunities(list) {
  return (Array.isArray(list) ? list : []).filter((opp) => !isHiddenFromPublicBoard(opp));
}

function isAcceptingApplications(opp) {
  if (isHiddenFromPublicBoard(opp)) return false;
  const max = Number(opp.max_volunteers);
  const filled = Number(opp.spots_filled || 0);
  if (Number.isFinite(max) && max > 0 && filled >= max) return false;
  if (opp.spots_remaining === 0) return false;
  return true;
}

module.exports = {
  HIDDEN_PUBLIC_TITLE,
  isHiddenFromPublicBoard,
  filterPublicBoardOpportunities,
  isAcceptingApplications,
};
