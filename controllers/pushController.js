'use strict';

const pushService = require('../utils/pushService');
const VolunteerProfile = require('../models/VolunteerProfile');
const { isStaffOrAdmin } = require('../middleware/auth');

function ensureAuth(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function getVapidPublicKey(req, res) {
  try {
    const key = pushService.getPublicKey();
    if (!key) {
      return res.status(503).json({ error: 'Web push is not configured', configured: false });
    }
    return res.status(200).json({ publicKey: key, configured: true });
  } catch (error) {
    console.error('[Push] getVapidPublicKey error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function subscribe(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    if (!pushService.isConfigured()) {
      return res.status(503).json({ error: 'Web push is not configured' });
    }
    const subscription = req.body?.subscription || req.body;
    const saved = await pushService.saveSubscription(
      req.session.userId,
      subscription,
      req.get('user-agent') || null
    );
    return res.status(201).json(saved);
  } catch (error) {
    console.error('[Push] subscribe error:', error.message);
    return res.status(400).json({ error: error.message || 'Invalid subscription' });
  }
}

async function unsubscribe(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }
    const removed = await pushService.removeSubscription(req.session.userId, endpoint);
    return res.status(200).json({ removed });
  } catch (error) {
    console.error('[Push] unsubscribe error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function coercePref(value, fallback) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return fallback;
}

async function updateNotificationPrefs(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const body = req.body || {};
    const prefs = {
      prefer_urgent: coercePref(body.prefer_urgent ?? body.preferUrgent, 1),
      prefer_reminders: coercePref(body.prefer_reminders ?? body.preferReminders, 1),
      prefer_threads: coercePref(body.prefer_threads ?? body.preferThreads, 0),
      prefer_fosters: coercePref(body.prefer_fosters ?? body.preferFosters, 0),
    };

    const existing = await VolunteerProfile.findByUserId(req.session.userId);
    if (!existing) {
      return res.status(404).json({ error: 'Complete your profile first' });
    }

    await VolunteerProfile.update(req.session.userId, prefs);
    const profile = await VolunteerProfile.findByUserId(req.session.userId);
    return res.status(200).json({
      prefer_urgent: Number(profile.prefer_urgent) || 0,
      prefer_reminders: Number(profile.prefer_reminders) || 0,
      prefer_threads: Number(profile.prefer_threads) || 0,
      prefer_fosters: Number(profile.prefer_fosters) || 0,
    });
  } catch (error) {
    console.error('[Push] updateNotificationPrefs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getNotificationPrefs(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const profile = await VolunteerProfile.findByUserId(req.session.userId);
    if (!profile) {
      return res.status(200).json({
        prefer_urgent: 1,
        prefer_reminders: 1,
        prefer_threads: 0,
        prefer_fosters: 0,
        configured: pushService.isConfigured(),
      });
    }
    return res.status(200).json({
      prefer_urgent: Number(profile.prefer_urgent ?? 1),
      prefer_reminders: Number(profile.prefer_reminders ?? 1),
      prefer_threads: Number(profile.prefer_threads ?? 0),
      prefer_fosters: Number(profile.prefer_fosters ?? 0),
      configured: pushService.isConfigured(),
    });
  } catch (error) {
    console.error('[Push] getNotificationPrefs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  updateNotificationPrefs,
  getNotificationPrefs,
  // exported for tests / unused staff guard helper
  isStaffOrAdmin,
};
