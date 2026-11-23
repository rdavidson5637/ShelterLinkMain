'use strict';

/**
 * Admin endpoints for the new-shelter setup checklist (SL-LATER-17).
 *   GET  /api/admin/setup-checklist
 *   POST /api/admin/setup-checklist/dismiss
 *   GET  /api/admin/settings/privacy-contact
 *   PUT  /api/admin/settings/privacy-contact
 */

const SetupChecklist = require('../models/SetupChecklist');

async function getSetupChecklist(req, res) {
  try {
    const checklist = await SetupChecklist.getChecklist();
    return res.status(200).json(checklist);
  } catch (error) {
    console.error('[SetupChecklist] getSetupChecklist error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function dismissSetupChecklist(req, res) {
  try {
    const checklist = await SetupChecklist.dismissChecklist();
    return res.status(200).json({
      message: 'Setup checklist dismissed',
      ...checklist,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    console.error('[SetupChecklist] dismissSetupChecklist error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPrivacyContact(req, res) {
  try {
    const settings = await SetupChecklist.getPrivacyContact();
    return res.status(200).json(settings);
  } catch (error) {
    console.error('[SetupChecklist] getPrivacyContact error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updatePrivacyContact(req, res) {
  try {
    const settings = await SetupChecklist.setPrivacyContact(
      req.body?.privacy_contact_email
    );
    return res.status(200).json({
      message: settings.privacy_contact_email
        ? 'Privacy contact email saved'
        : 'Privacy contact email cleared',
      ...settings,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    console.error('[SetupChecklist] updatePrivacyContact error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getSetupChecklist,
  dismissSetupChecklist,
  getPrivacyContact,
  updatePrivacyContact,
};
