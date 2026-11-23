'use strict';

/**
 * Optional after-shift notes from volunteers (SL-DAY-11).
 * Staff read-only on shift and volunteer pages. Email staff only when the
 * volunteer leaves a note and ticks notify.
 */

const VolunteerShiftNote = require('../models/VolunteerShiftNote');
const Opportunity = require('../models/Opportunity');
const { isStaffOrAdmin } = require('../middleware/auth');
const { isEmailConfigured } = require('../utils/emailConfig');
const emailService = require('../utils/emailService');
const { formatShelterDate } = require('../utils/shelterTime');

function ensureAuthed(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
}

function ensureStaff(req, res) {
  if (!ensureAuthed(req, res)) return false;
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function truthyFlag(value) {
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    String(value || '').toLowerCase() === 'true'
  );
}

async function listMine(req, res) {
  try {
    if (!ensureAuthed(req, res)) return;
    const rows = await VolunteerShiftNote.listEligibleForUser(req.session.userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[VolunteerShiftNote] listMine error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function saveMine(req, res) {
  try {
    if (!ensureAuthed(req, res)) return;

    const applicationId = req.body?.application_id ?? req.body?.applicationId;
    const body = req.body?.body;
    const notify = truthyFlag(req.body?.notify);

    const note = await VolunteerShiftNote.createOrUpdate({
      applicationId,
      userId: req.session.userId,
      body,
      notify,
    });

    let emailed = 0;
    let emailError = null;

    if (notify && note && !note.notify_emailed_at) {
      if (!isEmailConfigured()) {
        return res.status(201).json({
          note,
          emailed: 0,
          email_skipped: 'Email is not configured on this server.',
        });
      }
      try {
        const staffEmails = await VolunteerShiftNote.findStaffEmails();
        const details = {
          volunteerName: note.volunteer_name || 'A volunteer',
          title: note.opportunity_title || 'a shift',
          date: formatShelterDate(note.opportunity_start_date) || 'recently',
          body: note.body,
        };
        for (const email of staffEmails) {
          try {
            await emailService.sendVolunteerShiftNoteAlert(email, details);
            emailed += 1;
          } catch (err) {
            console.error('[VolunteerShiftNote] staff email failed:', err.message);
            emailError = err.message;
          }
        }
        if (emailed > 0) {
          await VolunteerShiftNote.markNotifyEmailed(note.id);
          note.notify_emailed_at = new Date().toISOString();
        }
      } catch (err) {
        console.error('[VolunteerShiftNote] notify path failed:', err.message);
        emailError = err.message;
      }
    }

    return res.status(201).json({
      note,
      emailed,
      ...(emailError ? { email_error: emailError } : {}),
    });
  } catch (error) {
    console.error('[VolunteerShiftNote] saveMine error:', error.message);
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listForOpportunity(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const opportunityId = Number(req.params.id || req.params.opportunityId);
    if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ error: 'Invalid opportunity id' });
    }
    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    const notes = await VolunteerShiftNote.findByOpportunityId(opportunityId);
    return res.status(200).json(notes);
  } catch (error) {
    console.error('[VolunteerShiftNote] listForOpportunity error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listForVolunteer(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const notes = await VolunteerShiftNote.findByUserId(userId);
    return res.status(200).json(notes);
  } catch (error) {
    console.error('[VolunteerShiftNote] listForVolunteer error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listMine,
  saveMine,
  listForOpportunity,
  listForVolunteer,
};
