'use strict';

/**
 * Web Push helper. Graceful no-op when VAPID keys are missing.
 */

const { pool } = require('../config/database');

const PREF_COLUMNS = {
  urgent: 'prefer_urgent',
  reminders: 'prefer_reminders',
  threads: 'prefer_threads',
  fosters: 'prefer_fosters',
};

let webPush = null;
let configured = null;

function getVapidConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '';
  const subject =
    process.env.WEB_PUSH_VAPID_SUBJECT ||
    process.env.VAPID_SUBJECT ||
    process.env.EMAIL_FROM ||
    'mailto:shelterlink@localhost';
  return {
    publicKey: String(publicKey).trim(),
    privateKey: String(privateKey).trim(),
    subject: String(subject).trim(),
  };
}

function isConfigured() {
  if (configured != null) return configured;
  const { publicKey, privateKey } = getVapidConfig();
  configured = Boolean(publicKey && privateKey);
  return configured;
}

function resetConfigCache() {
  configured = null;
  webPush = null;
}

function getPublicKey() {
  if (!isConfigured()) return null;
  return getVapidConfig().publicKey;
}

function loadWebPush() {
  if (webPush) return webPush;
  if (!isConfigured()) return null;
  // Lazy require so tests without the package / keys stay light.
  // eslint-disable-next-line global-require
  webPush = require('web-push');
  const { publicKey, privateKey, subject } = getVapidConfig();
  webPush.setVapidDetails(subject, publicKey, privateKey);
  return webPush;
}

async function saveSubscription(userId, subscription = {}, userAgent = null) {
  if (!userId) throw new Error('userId is required');
  const endpoint = subscription.endpoint;
  const keys = subscription.keys || {};
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Invalid push subscription');
  }

  const [result] = await pool.execute(
    `
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent
    `,
    [userId, endpoint, p256dh, auth, userAgent]
  );
  return {
    id: Number(result.insertId) || null,
    user_id: Number(userId),
    endpoint,
  };
}

async function removeSubscription(userId, endpoint) {
  if (!userId || !endpoint) return false;
  const [result] = await pool.execute(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
    [userId, endpoint]
  );
  return Number(result.affectedRows) > 0;
}

async function removeByEndpoint(endpoint) {
  if (!endpoint) return false;
  const [result] = await pool.execute(
    `DELETE FROM push_subscriptions WHERE endpoint = ?`,
    [endpoint]
  );
  return Number(result.affectedRows) > 0;
}

async function listSubscriptionsForUsers(userIds = []) {
  const ids = (Array.isArray(userIds) ? userIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `
      SELECT ps.*, vp.prefer_urgent, vp.prefer_reminders, vp.prefer_threads, vp.prefer_fosters
      FROM push_subscriptions ps
      LEFT JOIN volunteer_profiles vp ON vp.user_id = ps.user_id
      WHERE ps.user_id IN (${placeholders})
    `,
    ids
  );
  return rows;
}

function prefersCategory(row, category) {
  const col = PREF_COLUMNS[category];
  if (!col) return true;
  const raw = row[col];
  if (raw == null) {
    // Defaults: urgent/reminders on, others off.
    return category === 'urgent' || category === 'reminders';
  }
  return Number(raw) === 1;
}

/**
 * Send a push to users who opted into the category. No-op without VAPID keys.
 * @returns {{ sent: number, skipped: number, failed: number, configured: boolean }}
 */
async function sendToUsers(userIds, payload = {}, { category = 'urgent' } = {}) {
  if (!isConfigured()) {
    return { sent: 0, skipped: 0, failed: 0, configured: false };
  }

  const wp = loadWebPush();
  if (!wp) {
    return { sent: 0, skipped: 0, failed: 0, configured: false };
  }

  const rows = await listSubscriptionsForUsers(userIds);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

  for (const row of rows) {
    if (!prefersCategory(row, category)) {
      skipped += 1;
      continue;
    }
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      await wp.sendNotification(subscription, body);
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = error && (error.statusCode || error.status);
      if (statusCode === 404 || statusCode === 410) {
        try {
          await removeByEndpoint(row.endpoint);
        } catch (_) {
          /* ignore cleanup errors */
        }
      }
      console.error('[pushService] send failed:', error.message || error);
    }
  }

  return { sent, skipped, failed, configured: true };
}

module.exports = {
  PREF_COLUMNS,
  getVapidConfig,
  isConfigured,
  resetConfigCache,
  getPublicKey,
  saveSubscription,
  removeSubscription,
  removeByEndpoint,
  listSubscriptionsForUsers,
  prefersCategory,
  sendToUsers,
};
