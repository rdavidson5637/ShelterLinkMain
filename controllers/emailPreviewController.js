'use strict';

/**
 * Admin email preview (SL-LATER-38). Read-only; never sends mail.
 */

const { renderEmailPreviews } = require('../utils/emailPreview');

async function listEmailPreviews(req, res) {
  try {
    const payload = await renderEmailPreviews();
    return res.status(200).json(payload);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[EmailPreview] listEmailPreviews error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listEmailPreviews,
};
