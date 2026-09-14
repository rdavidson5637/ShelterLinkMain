'use strict';

function isTestOrE2EOpportunity(opp) {
  const title = String(opp?.title || '');
  const description = String(opp?.description || '');
  if (/^Smoke Test Shift\b/i.test(title)) return true;
  if (/\bE2E\b/.test(title)) return true;
  if (/Automated end-to-end test shift/i.test(description)) return true;
  return false;
}

function excludeTestOpportunities(list) {
  const rows = Array.isArray(list) ? list : [];
  if (process.env.NODE_ENV !== 'production') return rows;
  return rows.filter((opp) => !isTestOrE2EOpportunity(opp));
}

module.exports = {
  isTestOrE2EOpportunity,
  excludeTestOpportunities,
};
