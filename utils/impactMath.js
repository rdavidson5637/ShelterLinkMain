'use strict';

/**
 * Consecutive calendar months (walking backward from the latest month with activity)
 * that each appear in monthKeys ('YYYY-MM').
 */
function calculateStreakFromMonths(monthKeys) {
  const set = new Set((monthKeys || []).filter(Boolean));
  if (!set.size) return 0;

  const sorted = Array.from(set).sort();
  const latest = sorted[sorted.length - 1];
  let [y, m] = latest.split('-').map(Number);
  let streak = 0;

  while (set.has(`${y}-${String(m).padStart(2, '0')}`)) {
    streak += 1;
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return streak;
}

function nextBadgeProgressFrom(nextBadge) {
  if (!nextBadge) return null;
  const target = nextBadge.shiftsNeeded > 0 ? nextBadge.shiftsNeeded : nextBadge.hoursNeeded;
  const current = Number(nextBadge.currentProgress) || 0;
  return {
    id: nextBadge.id,
    label: nextBadge.label,
    current,
    target,
    percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 100,
  };
}

module.exports = {
  calculateStreakFromMonths,
  nextBadgeProgressFrom,
};
