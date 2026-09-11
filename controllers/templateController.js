'use strict';

const OpportunityTemplate = require('../models/OpportunityTemplate');
const { isStaffOrAdmin } = require('../middleware/auth');

async function listTemplates(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const rows = await OpportunityTemplate.listAll();
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Templates] listTemplates error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createTemplate(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const name = req.body?.name;
    const payload = req.body?.payload || req.body?.payload_json || {};
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    let parsed = payload;
    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload);
      } catch {
        return res.status(400).json({ error: 'payload must be valid JSON' });
      }
    }
    const row = await OpportunityTemplate.create({
      name,
      payload: parsed,
      createdBy: req.session.userId,
    });
    return res.status(201).json(row);
  } catch (error) {
    console.error('[Templates] createTemplate error:', error.message);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function getTemplate(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const row = await OpportunityTemplate.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Template not found' });
    }
    return res.status(200).json(row);
  } catch (error) {
    console.error('[Templates] getTemplate error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteTemplate(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ok = await OpportunityTemplate.remove(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Template not found' });
    }
    return res.status(200).json({ deleted: true });
  } catch (error) {
    console.error('[Templates] deleteTemplate error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Save current opportunity fields as a named template (from create page).
 */
async function saveFromOpportunityBody(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const name = req.body?.name || req.body?.template_name;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const {
      title,
      description,
      requirements,
      location,
      max_volunteers,
      cancellation_cutoff_hours,
      qualification_ids,
      tag_ids,
      animal_ids,
      required_background_check_type,
    } = req.body || {};

    const payload = {
      title: title || null,
      description: description || null,
      requirements: requirements || null,
      location: location || null,
      max_volunteers: max_volunteers ?? null,
      cancellation_cutoff_hours: cancellation_cutoff_hours ?? 24,
      qualification_ids: Array.isArray(qualification_ids) ? qualification_ids : [],
      tag_ids: Array.isArray(tag_ids) ? tag_ids : [],
      animal_ids: Array.isArray(animal_ids) ? animal_ids : [],
      required_background_check_type: required_background_check_type || null,
    };

    const row = await OpportunityTemplate.create({
      name,
      payload,
      createdBy: req.session.userId,
    });
    return res.status(201).json(row);
  } catch (error) {
    console.error('[Templates] saveFromOpportunityBody error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listTemplates,
  createTemplate,
  getTemplate,
  deleteTemplate,
  saveFromOpportunityBody,
};
