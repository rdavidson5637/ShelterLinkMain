'use strict';

/**
 * Charity register lookups (self-serve brief sections 6 and 9 item 4).
 *
 *   const { lookupCharity } = require('./services/charityRegister');
 *   const result = await lookupCharity('ccew', '1234567');
 *
 * Every adapter returns the shape documented in result.js:
 *   { found, name, status, removedAt, source, checkedAt }
 *
 * Launch regulators: ccew (Register API) and ccni (imported CSV cache).
 * oscr and cri are stubs that return 'not_configured'.
 *
 * A register answer is evidence for the platform owner, never proof of who
 * is applying. It must not approve anything by itself: the platform owner's
 * one-click approval stays the gate. When the lookup is 'unavailable' or
 * 'not_configured', the caller keeps the application pending and unverified
 * (see docs/charity-register.md).
 */

const formats = require('./formats');
const { unknownResult, STATUSES } = require('./result');
const ccew = require('./ccew');
const ccni = require('./ccni');
const oscr = require('./oscr');
const cri = require('./cri');

const ADAPTERS = Object.freeze({ ccew, ccni, oscr, cri });
const LIVE_REGULATORS = Object.freeze(['ccew', 'ccni']);

/**
 * @param {string} regulator  ccew | oscr | ccni | cri
 * @param {string} rawNumber  what the applicant typed
 * @param {object} [opts]     passed to the adapter (fetch, apiKey, db, now)
 */
async function lookupCharity(regulator, rawNumber, opts = {}) {
  const reg = String(regulator == null ? '' : regulator).trim().toLowerCase();
  if (!formats.isRegulator(reg)) {
    return unknownResult('invalid_format', 'none', opts.now, { message: formats.MESSAGES.regulator });
  }
  return ADAPTERS[reg].lookup(rawNumber, opts);
}

/** True when the platform owner still has to check the register by hand. */
function needsHandCheck(result) {
  return !result || result.found !== true || result.status !== 'registered';
}

module.exports = {
  lookupCharity,
  needsHandCheck,
  ADAPTERS,
  LIVE_REGULATORS,
  STATUSES,
  ...formats,
};
