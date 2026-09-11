'use strict';

const Certificate = require('../models/Certificate');
const Badge = require('../models/Badge');
const User = require('../models/User');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function publicVerifyPayload(cert) {
  if (!cert) return null;
  const last = (cert.last_name || '').trim();
  const lastInitial = last ? `${last.charAt(0).toUpperCase()}.` : '';
  return {
    first_name: cert.first_name || '',
    last_initial: lastInitial,
    hours: Number(cert.hours_at_issue) || 0,
    shifts: Number(cert.shifts_at_issue) || 0,
    issued_at: cert.issued_at,
    code: cert.code,
  };
}

function fullCertificatePayload(cert, extras = {}) {
  if (!cert) return null;
  return {
    id: cert.id,
    code: cert.code,
    issued_at: cert.issued_at,
    hours_at_issue: Number(cert.hours_at_issue) || 0,
    shifts_at_issue: Number(cert.shifts_at_issue) || 0,
    first_name: cert.first_name || '',
    last_name: cert.last_name || '',
    ...extras,
  };
}

async function getMyCertificate(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const cert = await Certificate.findLatestByUserId(userId);
    if (!cert) {
      return res.status(404).json({ error: 'No certificate issued yet' });
    }
    let badges = [];
    try {
      const badgeData = await Badge.calculateBadges(userId);
      badges = badgeData.earned || [];
    } catch (_) {
      badges = [];
    }
    return res.status(200).json(fullCertificatePayload(cert, { badges }));
  } catch (error) {
    console.error('[Certificate] getMyCertificate error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function issueMyCertificate(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const cert = await Certificate.issueForUser(userId);
    let badges = [];
    try {
      const badgeData = await Badge.calculateBadges(userId);
      badges = badgeData.earned || [];
    } catch (_) {
      badges = [];
    }
    return res.status(201).json(fullCertificatePayload(cert, { badges }));
  } catch (error) {
    console.error('[Certificate] issueMyCertificate error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function verifyCertificate(req, res) {
  try {
    const code = String(req.params.code || '').trim();
    if (!code || code.length > 12) {
      return res.status(404).json({ error: 'Certificate not found' });
    }
    const cert = await Certificate.findByCode(code);
    if (!cert) {
      return res.status(404).json({ error: 'Certificate not found' });
    }
    return res.status(200).json(publicVerifyPayload(cert));
  } catch (error) {
    console.error('[Certificate] verifyCertificate error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getMyCertificate,
  issueMyCertificate,
  verifyCertificate,
  publicVerifyPayload,
};
