'use strict';

/**
 * Charities Regulator (Ireland). Not live for launch: launch covers Northern
 * Ireland and England and Wales only.
 *
 * The Charities Regulator publishes its register as a download rather than
 * an API, so the likely path is the same as CCNI: import into
 * charity_register_cache (migration 037 already allows regulator 'cri') and
 * read from there. Until that importer exists, every lookup returns
 * 'not_configured' and the platform owner checks the register by hand.
 */

const { validateCharityNumber } = require('./formats');
const { unknownResult } = require('./result');

const SOURCE = 'cri_csv';

async function lookup(rawNumber, opts = {}) {
  const checked = validateCharityNumber('cri', rawNumber);
  if (!checked.ok) return unknownResult('invalid_format', SOURCE, opts.now, { message: checked.error });
  return unknownResult('not_configured', SOURCE, opts.now, {
    error: 'cri_not_live',
    message: 'Irish register lookups are not live yet. Check the charity by hand on the Charities Regulator register.',
  });
}

module.exports = { lookup, SOURCE };
