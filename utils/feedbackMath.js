'use strict';

/**
 * Average of integer ratings (1–5). Returns null when empty.
 * Rounded to 2 decimal places.
 */
function averageRating(ratings) {
  const nums = (ratings || [])
    .map((r) => Number(r))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const sum = nums.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / nums.length) * 100) / 100;
}

/**
 * Group feedback rows by opportunity and compute average rating per group.
 * Each row needs { opportunity_id, opportunity_title?, rating }.
 */
function averagesByOpportunity(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const oid = Number(row.opportunity_id);
    if (!Number.isFinite(oid)) continue;
    if (!map.has(oid)) {
      map.set(oid, {
        opportunity_id: oid,
        opportunity_title: row.opportunity_title || `Opportunity #${oid}`,
        ratings: [],
      });
    }
    const entry = map.get(oid);
    if (row.opportunity_title) entry.opportunity_title = row.opportunity_title;
    entry.ratings.push(row.rating);
  }

  return Array.from(map.values())
    .map((entry) => ({
      opportunity_id: entry.opportunity_id,
      opportunity_title: entry.opportunity_title,
      count: entry.ratings.length,
      average: averageRating(entry.ratings),
    }))
    .sort((a, b) => a.opportunity_title.localeCompare(b.opportunity_title));
}

module.exports = {
  averageRating,
  averagesByOpportunity,
};
