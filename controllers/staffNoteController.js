'use strict';

/**
 * Private staff notes on a volunteer profile (SL-DAY-15).
 * Staff/admin only. Never exposed to the volunteer.
 */

const StaffNote = require('../models/StaffNote');
const { isStaffOrAdmin } = require('../middleware/auth');

function ensureStaff(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

async function listVolunteerStaffNotes(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const summary = await StaffNote.listForVolunteer(req.params.userId);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[StaffNote] list error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createVolunteerStaffNote(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body?.body ?? req.body?.note ?? '';
    const result = await StaffNote.create({
      volunteerUserId: req.params.userId,
      authorUserId: req.session.userId,
      body,
    });
    return res.status(201).json(result);
  } catch (error) {
    console.error('[StaffNote] create error:', error.message);
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateVolunteerStaffNote(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body?.body ?? req.body?.note ?? '';
    const result = await StaffNote.update({
      noteId: req.params.noteId,
      volunteerUserId: req.params.userId,
      editorUserId: req.session.userId,
      body,
    });
    // Surface previous text so the audit middleware detail can record the edit.
    if (res.locals) {
      res.locals.staffNotePreviousBody = result.previous_body;
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('[StaffNote] update error:', error.message);
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteVolunteerStaffNote(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const result = await StaffNote.remove({
      noteId: req.params.noteId,
      volunteerUserId: req.params.userId,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[StaffNote] delete error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listVolunteerStaffNotes,
  createVolunteerStaffNote,
  updateVolunteerStaffNote,
  deleteVolunteerStaffNote,
};
