'use strict';

/**
 * Scottish Charity Regulator (OSCR). Not live for launch: launch covers
 * Northern Ireland and England and Wales only.
 *
 * OSCR offers a register API behind a key (OSCR_API_KEY, name reserved in
 * check-prod). Until an adapter is written against it, every lookup returns
 * 'not_configured' and the platform owner checks the OSCR website by hand.
 */

const { validateCharityNumber } = require('./formats');
const { unknownResult } = require('./result');

const SOURCE = 'oscr_api';

async function lookup(rawNumber, opts = {}) {
  const checked = validateCharityNumber('oscr', rawNumber);
  if (!checked.ok) return unknownResult('invalid_format', SOURCE, opts.now, { message: checked.error });
  return unknownResult('not_configured', SOURCE, opts.now, {
    error: 'oscr_not_live',
    message: 'Scottish register lookups are not live yet. Check the charity by hand on the OSCR register.',
  });
}

module.exports = { lookup, SOURCE };
