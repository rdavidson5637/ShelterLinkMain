'use strict';

/**
 * The one shape every register adapter returns (self-serve brief section 6):
 *
 *   found      true   the register has this number
 *              false  the register answered and does not have it
 *              null   we could not tell (lookup down, not configured, bad input)
 *   name       registered name, or null
 *   status     'registered'      on the register now
 *              'removed'         was registered, since removed
 *              'not_found'       register answered, number not there
 *              'unavailable'     lookup failed (network, timeout, 5xx, auth)
 *              'not_configured'  no adapter or key for this regulator yet
 *              'invalid_format'  number fails formats.js, nothing was looked up
 *   removedAt  'YYYY-MM-DD' when status is 'removed' and the register says when
 *   source     where the answer came from, e.g. 'ccew_api', 'ccni_csv'
 *   checkedAt  ISO timestamp of this lookup
 *
 * Optional extras: error (short machine code, never a secret or raw body),
 * message (text fit for a platform owner), cachedAt (when a cached row was
 * imported).
 *
 * A register answer is evidence only. It never proves who is applying.
 */

const STATUSES = Object.freeze([
  'registered',
  'removed',
  'not_found',
  'unavailable',
  'not_configured',
  'invalid_format',
]);

function toIso(now) {
  const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  return d.toISOString();
}

function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const s = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
  return null;
}

function registerResult({ found, name = null, status, removedAt = null, source, now, ...extra }) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown register status: ${status}`);
  return {
    found,
    name: name ? String(name).trim() : null,
    status,
    removedAt: status === 'removed' ? toDateOnly(removedAt) : null,
    source,
    checkedAt: toIso(now),
    ...extra,
  };
}

function unknownResult(status, source, now, extra = {}) {
  return registerResult({ found: null, status, source, now, ...extra });
}

module.exports = { STATUSES, registerResult, unknownResult, toDateOnly, toIso };
