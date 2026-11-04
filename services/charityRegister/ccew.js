'use strict';

/**
 * Charity Commission for England and Wales: Register API client.
 *
 *   GET {CCEW_API_URL}/charitydetails/{registeredNumber}/{suffix}
 *   Header: Ocp-Apim-Subscription-Key: {CCEW_API_KEY}
 *
 * Key comes from the Commission's developer portal. Set CCEW_API_KEY in the
 * environment; without it every lookup returns status 'not_configured'.
 * CCEW_API_URL is optional and only for pointing at a test double.
 *
 * Response fields read: charity_name, reg_status ('R' registered, 'RM'
 * removed), date_of_removal. Field names follow the published API
 * definition; confirm them against a live key before PR6 relies on them.
 *
 * Never throws for a register or network problem. A failed lookup returns
 * status 'unavailable' so the caller can keep the application pending.
 * The API key is never logged or returned.
 */

const { validateCharityNumber } = require('./formats');
const { registerResult, unknownResult } = require('./result');

const SOURCE = 'ccew_api';
const DEFAULT_BASE_URL = 'https://api.charitycommission.gov.uk/register/api';
const DEFAULT_TIMEOUT_MS = 8000;

function splitNumber(value) {
  const [main, suffix] = value.split('-');
  return { main, suffix: suffix ? String(Number(suffix)) : '0' };
}

function mapStatus(regStatus) {
  const s = String(regStatus == null ? '' : regStatus).trim().toUpperCase();
  if (s === 'R') return 'registered';
  if (s === 'RM') return 'removed';
  return null;
}

/**
 * Look up one charity on the E&W register.
 *
 * @param {string} rawNumber  what the applicant typed
 * @param {object} [opts]
 * @param {string} [opts.apiKey]     defaults to process.env.CCEW_API_KEY
 * @param {string} [opts.baseUrl]    defaults to CCEW_API_URL or the live API
 * @param {Function} [opts.fetch]    defaults to global fetch (tests inject)
 * @param {number} [opts.timeoutMs]
 * @param {Date|number} [opts.now]
 */
async function lookup(rawNumber, opts = {}) {
  const now = opts.now;
  const checked = validateCharityNumber('ccew', rawNumber);
  if (!checked.ok) return unknownResult('invalid_format', SOURCE, now, { message: checked.error });

  const apiKey = opts.apiKey !== undefined ? opts.apiKey : process.env.CCEW_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return unknownResult('not_configured', SOURCE, now, {
      error: 'ccew_api_key_missing',
      message: 'CCEW_API_KEY is not set. Check the charity by hand on the Charity Commission register.',
    });
  }

  const doFetch = opts.fetch || globalThis.fetch;
  const baseUrl = String(opts.baseUrl || process.env.CCEW_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const { main, suffix } = splitNumber(checked.value);
  const url = `${baseUrl}/charitydetails/${encodeURIComponent(main)}/${encodeURIComponent(suffix)}`;

  let res;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': String(apiKey).trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return unknownResult('unavailable', SOURCE, now, { error: timedOut ? 'ccew_timeout' : 'ccew_network' });
  }

  if (res.status === 404) return registerResult({ found: false, status: 'not_found', source: SOURCE, now });
  if (res.status === 401 || res.status === 403) {
    return unknownResult('unavailable', SOURCE, now, { error: 'ccew_auth' });
  }
  if (res.status === 429) return unknownResult('unavailable', SOURCE, now, { error: 'ccew_rate_limited' });
  if (!res.ok) return unknownResult('unavailable', SOURCE, now, { error: `ccew_http_${res.status}` });

  let body;
  try {
    const text = await res.text();
    body = text && text.trim() ? JSON.parse(text) : null;
  } catch {
    return unknownResult('unavailable', SOURCE, now, { error: 'ccew_bad_response' });
  }

  // The API answers 200 with an empty body for a number it does not hold.
  if (Array.isArray(body)) body = body[0] || null;
  if (!body || typeof body !== 'object' || !body.charity_name) {
    return registerResult({ found: false, status: 'not_found', source: SOURCE, now });
  }

  const status = mapStatus(body.reg_status);
  if (!status) {
    return unknownResult('unavailable', SOURCE, now, { error: 'ccew_unknown_status', name: body.charity_name });
  }

  return registerResult({
    found: true,
    name: body.charity_name,
    status,
    removedAt: body.date_of_removal,
    source: SOURCE,
    now,
  });
}

module.exports = { lookup, SOURCE, DEFAULT_BASE_URL, splitNumber, mapStatus };
