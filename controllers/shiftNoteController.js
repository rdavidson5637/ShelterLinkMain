'use strict';

const ShiftNote = require('../models/ShiftNote');
const Opportunity = require('../models/Opportunity');
const Application = require('../models/Application');
const { isStaffOrAdmin, isAdminUser } = require('../middleware/auth');
const { sendShiftNoteUpdate } = require('../utils/emailService');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function formatDate(value) {
  if (!value) return 'TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

async function listNotes(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ error: 'Invalid opportunity id' });
    }

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const notes = await ShiftNote.findByOpportunityId(opportunityId);
    return res.status(200).json(notes);
  } catch (error) {
    console.error('[ShiftNotes] listNotes error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createNote(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ error: 'Invalid opportunity id' });
    }

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      return res.status(400).json({ error: 'body is required' });
    }

    const notifyRaw = req.body?.notify;
    const notify =
      notifyRaw === true ||
      notifyRaw === 1 ||
      notifyRaw === '1' ||
      String(notifyRaw).toLowerCase() === 'true';

    const note = await ShiftNote.create({
      opportunityId,
      authorId: req.session.userId,
      body,
      notify: notify ? 1 : 0,
    });

    let emailed = 0;
    if (notify) {
      const apps = await Application.findByOpportunityId(opportunityId);
      const accepted = apps.filter(
        (a) => a.status === 'accepted' || a.status === 'approved'
      );
      const details = {
        title: opportunity.title,
        date: formatDate(opportunity.start_date),
        body,
      };
      for (const app of accepted) {
        if (!app.email) continue;
        try {
          await sendShiftNoteUpdate(app.email, details);
          emailed += 1;
        } catch (emailError) {
          console.error(
            '[ShiftNotes] notify email failed for',
            app.email,
            emailError.message
          );
        }
      }
    }

    return res.status(201).json({ ...note, emailed });
  } catch (error) {
    console.error('[ShiftNotes] createNote error:', error.message);
    if (/body is required|opportunityId|authorId/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteNote(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdminUser(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const opportunityId = Number(req.params.id);
    const noteId = Number(req.params.noteId);
    if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ error: 'Invalid opportunity id' });
    }
    if (!Number.isFinite(noteId) || noteId <= 0) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const existing = await ShiftNote.findById(noteId);
    if (!existing || Number(existing.opportunity_id) !== opportunityId) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const removed = await ShiftNote.remove(noteId);
    if (!removed) {
      return res.status(404).json({ error: 'Note not found' });
    }
    return res.status(200).json({ message: 'Note deleted' });
  } catch (error) {
    console.error('[ShiftNotes] deleteNote error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listNotes,
  createNote,
  deleteNote,
};
