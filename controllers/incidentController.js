'use strict';

const Incident = require('../models/Incident');
const { isStaffOrAdmin } = require('../middleware/auth');

function ensureStaff(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

async function listIncidents(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const incidents = await Incident.list({
      animalId: req.query.animal_id || null,
      opportunityId: req.query.opportunity_id || null,
      unresolvedOnly:
        req.query.unresolved === '1' ||
        req.query.unresolved === 'true',
    });
    return res.status(200).json(incidents);
  } catch (error) {
    console.error('[Incident] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getIncident(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    return res.status(200).json(incident);
  } catch (error) {
    console.error('[Incident] get error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createIncident(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body || {};
    const incident = await Incident.create({
      animalId: body.animal_id,
      opportunityId: body.opportunity_id,
      reportedBy: req.session.userId,
      body: body.body,
      severity: body.severity,
    });
    return res.status(201).json(incident);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Incident] create error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateIncident(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const incident = await Incident.update(req.params.id, req.body || {});
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    return res.status(200).json(incident);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Incident] update error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function resolveIncident(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const incident = await Incident.resolve(req.params.id, req.session.userId);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    return res.status(200).json(incident);
  } catch (error) {
    console.error('[Incident] resolve error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteIncident(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const ok = await Incident.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Incident not found' });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[Incident] delete error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  resolveIncident,
  deleteIncident,
};
