'use strict';

/**
 * Progress math for community-service hour targets.
 * @param {{ requiredHours?: number|string|null, approvedHours?: number|string|null }} input
 */
function communityServiceProgress({ requiredHours = 0, approvedHours = 0 } = {}) {
  const target = Math.max(Number(requiredHours) || 0, 0);
  const approved = Math.max(Number(approvedHours) || 0, 0);
  const remaining = Math.max(target - approved, 0);
  const percent = target > 0 ? Math.min(100, Math.round((approved / target) * 100)) : 0;
  const completed = target > 0 && approved >= target;
  return {
    target,
    approved,
    remaining,
    percent,
    completed,
  };
}

module.exports = {
  communityServiceProgress,
};
