/**
 * Shared status badge for volunteer and admin lists.
 * Colours live in custom.css (`.badge--pending` etc); this module only
 * maps a status string to a label and class name.
 */

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  waitlisted: 'Waitlisted',
  open: 'Open',
  closed: 'Closed',
  confirmed: 'Confirmed',
  declined: 'Declined',
  'no-show': 'No-show',
};

function sentenceCase(value) {
  const text = String(value || '').trim();
  if (!text) return 'Unknown';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** Canonical key: lowercase, underscores to hyphens. Unknown -> "neutral". */
export function normalizeStatus(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, key) ? key : 'neutral';
}

export function statusLabel(status, options = {}) {
  const key = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  const base = STATUS_LABELS[key] || sentenceCase(status);
  const suffix = options.suffix != null ? String(options.suffix) : '';
  return `${base}${suffix}`;
}

export function statusClassName(status) {
  return `badge badge--${normalizeStatus(status)}`;
}

/**
 * @param {string} status
 * @param {{ suffix?: string }} [options]
 * @returns {HTMLSpanElement}
 */
export function createStatusBadge(status, options = {}) {
  const span = document.createElement('span');
  span.className = statusClassName(status);
  span.textContent = statusLabel(status, options);
  return span;
}

export { STATUS_LABELS };
