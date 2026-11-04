'use strict';

/**
 * Offline format checks for charity numbers (self-serve brief section 6).
 * These only say whether a number is shaped right for its regulator. They do
 * not say the charity exists. Register lookups live elsewhere.
 *
 *   ccew  Charity Commission for England and Wales  6 or 7 digits, optional
 *                                                   subsidiary suffix (-1)
 *   oscr  Scottish Charity Regulator                SC + 6 digits
 *   ccni  Charity Commission for Northern Ireland   NIC + 6 digits
 *   cri   Charities Regulator (Ireland)             RCN, 8 digits (not CHY)
 */

const REGULATORS = Object.freeze(['ccew', 'oscr', 'ccni', 'cri']);

const REGULATOR_NAMES = Object.freeze({
  ccew: 'Charity Commission for England and Wales',
  oscr: 'Scottish Charity Regulator (OSCR)',
  ccni: 'Charity Commission for Northern Ireland',
  cri: 'Charities Regulator (Ireland)',
});

const FORMATS = Object.freeze({
  ccew: /^\d{6,7}(-\d{1,3})?$/,
  oscr: /^SC\d{6}$/,
  ccni: /^NIC\d{6}$/,
  cri: /^\d{8}$/,
});

const MESSAGES = Object.freeze({
  required: 'Enter your charity number.',
  regulator: 'Choose which regulator your charity is registered with.',
  ccew: 'Charity Commission for England and Wales numbers are 6 or 7 digits, for example 1234567. A subsidiary number adds a dash and a number, for example 1234567-1.',
  oscr: 'Scottish charity numbers start with SC followed by 6 digits, for example SC012345.',
  ccni: 'Northern Ireland charity numbers start with NIC followed by 6 digits, for example NIC100001.',
  ccniLegacy: 'XN and XR numbers are HMRC references, not Charity Commission for Northern Ireland numbers. Use your NIC number, for example NIC100001.',
  cri: 'Irish charity numbers (RCN) are 8 digits, for example 20012345.',
  criChy: 'CHY numbers are Revenue tax references, not Charities Regulator numbers. Use your 8 digit RCN, for example 20012345.',
});

function isRegulator(value) {
  return REGULATORS.includes(value);
}

/**
 * Tidy what a person typed: trim, drop spaces, upper-case letters, and for
 * Ireland drop a leading "RCN" label. Returns '' for empty input.
 */
function normaliseCharityNumber(regulator, raw) {
  let value = String(raw == null ? '' : raw).replace(/\s+/g, '').toUpperCase();
  if (regulator === 'cri') value = value.replace(/^RCN:?/, '');
  return value;
}

/**
 * Check a charity number against its regulator's format.
 * Returns { ok: true, regulator, value } with the normalised number, or
 * { ok: false, error } with a message fit to show the applicant.
 */
function validateCharityNumber(regulator, raw) {
  const reg = String(regulator == null ? '' : regulator).trim().toLowerCase();
  if (!isRegulator(reg)) return { ok: false, error: MESSAGES.regulator };

  const value = normaliseCharityNumber(reg, raw);
  if (!value) return { ok: false, error: MESSAGES.required };

  if (reg === 'ccni' && /^X[NR]/.test(value)) return { ok: false, error: MESSAGES.ccniLegacy };
  if (reg === 'cri' && /^CHY/.test(value)) return { ok: false, error: MESSAGES.criChy };

  if (!FORMATS[reg].test(value)) return { ok: false, error: MESSAGES[reg] };
  return { ok: true, regulator: reg, value };
}

function isValidCharityNumber(regulator, raw) {
  return validateCharityNumber(regulator, raw).ok;
}

module.exports = {
  REGULATORS,
  REGULATOR_NAMES,
  FORMATS,
  MESSAGES,
  isRegulator,
  normaliseCharityNumber,
  validateCharityNumber,
  isValidCharityNumber,
};
