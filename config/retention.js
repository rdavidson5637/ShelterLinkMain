'use strict';

// Periods are null until Assisi confirms them. A null period is skipped.
// Set the matching environment variable to a positive number to turn one on.
function optionalNumber(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function cutoffFrom(now, amount, unit) {
  const cutoff = new Date(now);
  if (unit === 'hours') cutoff.setHours(cutoff.getHours() - amount);
  else cutoff.setFullYear(cutoff.getFullYear() - amount);
  return cutoff;
}

function periods() {
  return {
    inactiveVolunteerYears:
      optionalNumber('RETENTION_INACTIVE_VOLUNTEER_YEARS')
      ?? optionalNumber('DATA_RETENTION_YEARS'),
    applicationYears: optionalNumber('RETENTION_APPLICATION_YEARS'),
    hoursYears: optionalNumber('RETENTION_HOURS_YEARS'),
    auditLogYears: optionalNumber('RETENTION_AUDIT_LOG_YEARS'),
    groupBookingYears: optionalNumber('RETENTION_GROUP_BOOKING_YEARS'),
    resetTokenHours: optionalNumber('RETENTION_RESET_TOKEN_HOURS'),
  };
}

module.exports = {
  optionalNumber,
  periods,
  cutoffFrom,
};
