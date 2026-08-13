'use strict';

/**
 * True when volunteers may no longer self-cancel an accepted shift
 * (inside cancellation_cutoff_hours of start). Missing/invalid start => false.
 */
function isWithinCancellationCutoff(startDate, cutoffHours, now = new Date()) {
  if (!startDate) return false;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return false;
  const hours = Number(cutoffHours);
  const safeHours = Number.isFinite(hours) && hours >= 0 ? hours : 24;
  const msUntil = start.getTime() - now.getTime();
  return msUntil <= safeHours * 60 * 60 * 1000;
}

module.exports = {
  isWithinCancellationCutoff,
};
