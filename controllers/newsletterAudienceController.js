'use strict';

/**
 * Newsletter audience export (SL-LATER-15).
 *
 * Staff/admin download a CSV of volunteers who gave explicit marketing
 * consent (marketing_consent = 1), including the consent date. Operational
 * notification prefs are not enough. Tenancy comes from the shelter-bound
 * pool (RLS on users / volunteer_profiles).
 *
 * Provider sync (Brevo / Mailchimp) is separate and ships disabled — see
 * utils/newsletter/syncProvider.js.
 */

const { pool } = require('../config/database');
const { convertToCSV } = require('../utils/csvExport');
const { getNewsletterSyncProvider } = require('../utils/newsletter/syncProvider');

const CSV_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'marketing_consent_at',
];

function setCsvHeaders(res, filename) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

function formatConsentAt(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

async function fetchNewsletterAudience() {
  const sql = `
    SELECT
      u.first_name,
      u.last_name,
      u.email,
      u.phone,
      vp.marketing_consent_at
    FROM users u
    INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
    WHERE u.role = 'volunteer'
      AND vp.marketing_consent = 1
      AND vp.marketing_consent_at IS NOT NULL
      AND u.anonymised_at IS NULL
    ORDER BY u.last_name, u.first_name, u.email
  `;
  const [rows] = await pool.execute(sql);
  return rows.map((row) => ({
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    email: row.email || '',
    phone: row.phone || '',
    marketing_consent_at: formatConsentAt(row.marketing_consent_at),
  }));
}

async function getNewsletterAudienceCsv(req, res) {
  try {
    const data = await fetchNewsletterAudience();
    const csv = convertToCSV(data, CSV_FIELDS);
    setCsvHeaders(res, 'newsletter-audience.csv');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[Newsletter] getNewsletterAudienceCsv error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Report sync provider status. Never contacts Brevo/Mailchimp; the default
 * provider is always disabled.
 */
async function getNewsletterSyncStatus(req, res) {
  try {
    const provider = getNewsletterSyncProvider();
    return res.status(200).json({
      enabled: provider.isEnabled(),
      provider: provider.name,
      message: provider.isEnabled()
        ? 'Newsletter sync is configured.'
        : 'Newsletter sync is switched off. Export the CSV and import it manually, or ask Ryan before enabling a provider.',
    });
  } catch (error) {
    console.error('[Newsletter] getNewsletterSyncStatus error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Attempt a sync. Always no-op while the disabled provider is active.
 */
async function postNewsletterSync(req, res) {
  try {
    const provider = getNewsletterSyncProvider();
    if (!provider.isEnabled()) {
      return res.status(503).json({
        error: 'Newsletter sync is not configured.',
        reason: 'newsletter_sync_disabled',
        provider: provider.name,
      });
    }
    const contacts = await fetchNewsletterAudience();
    const result = await provider.syncAudience({
      contacts,
      shelterId: req.shelterId || null,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Newsletter] postNewsletterSync error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  CSV_FIELDS,
  fetchNewsletterAudience,
  formatConsentAt,
  getNewsletterAudienceCsv,
  getNewsletterSyncStatus,
  postNewsletterSync,
};
