'use strict';

const Transport = require('../models/Transport');
const VolunteerProfile = require('../models/VolunteerProfile');
const MessageThread = require('../models/MessageThread');
const AdminMessage = require('../models/AdminMessage');
const { isStaffOrAdmin } = require('../middleware/auth');
const { sendUrgentCover } = require('../utils/emailService');

function ensureAuth(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function ensureStaff(req, res) {
  if (!ensureAuth(req, res)) return false;
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

async function ensureApprovedVolunteer(req, res) {
  if (!ensureAuth(req, res)) return false;
  if (isStaffOrAdmin(req)) return true;
  const profile = await VolunteerProfile.findByUserId(req.session.userId);
  if (!profile || Number(profile.approved) !== 1) {
    res.status(403).json({ error: 'Approved volunteer profile required' });
    return false;
  }
  return true;
}

async function createRun(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body || {};
    const run = await Transport.createRun({
      animalId: body.animal_id,
      title: body.title,
      runDate: body.run_date,
      notes: body.notes,
      createdBy: req.session.userId,
      legs: body.legs || [],
    });
    return res.status(201).json(run);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Transport] createRun error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listRuns(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const runs = await Transport.listRuns({ status: req.query.status || null });
    return res.status(200).json(runs);
  } catch (error) {
    console.error('[Transport] listRuns error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getRun(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const staff = isStaffOrAdmin(req);
    if (!staff) {
      const ok = await ensureApprovedVolunteer(req, res);
      if (!ok) return;
    }
    const detail = await Transport.getRunDetail(req.params.id, {
      includeContact: staff,
    });
    if (!detail) return res.status(404).json({ error: 'Transport run not found' });

    if (!staff) {
      const safeLegs = (detail.legs || []).map((leg) => {
        const safe = Transport.toVolunteerSafeLeg({
          ...leg,
          run_title: detail.title,
          run_date: detail.run_date,
          run_status: detail.status,
          animal_id: detail.animal_id,
          animal_name: detail.animal_name,
        });
        return safe;
      });
      return res.status(200).json({
        id: detail.id,
        title: detail.title,
        run_date: detail.run_date,
        status: detail.status,
        notes: detail.notes,
        animal_id: detail.animal_id,
        animal_name: detail.animal_name,
        legs: safeLegs,
        coordination: Transport.COORDINATION_HINT,
        message_context: {
          context_type: 'transport_run',
          context_id: detail.id,
        },
      });
    }

    return res.status(200).json(detail);
  } catch (error) {
    console.error('[Transport] getRun error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateRunStatus(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const status = (req.body || {}).status;
    const run = await Transport.updateRunStatus(req.params.id, status);
    if (!run) return res.status(404).json({ error: 'Transport run not found' });
    return res.status(200).json(run);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Transport] updateRunStatus error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listOpenLegs(req, res) {
  try {
    if (!(await ensureApprovedVolunteer(req, res))) return;
    const legs = await Transport.listOpenLegsForVolunteers();
    return res.status(200).json({
      legs,
      coordination: Transport.COORDINATION_HINT,
    });
  } catch (error) {
    console.error('[Transport] listOpenLegs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMyLegs(req, res) {
  try {
    if (!(await ensureApprovedVolunteer(req, res))) return;
    const legs = await Transport.listMyLegs(req.session.userId);
    return res.status(200).json({
      legs,
      coordination: Transport.COORDINATION_HINT,
    });
  } catch (error) {
    console.error('[Transport] listMyLegs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function claimLeg(req, res) {
  try {
    if (!(await ensureApprovedVolunteer(req, res))) return;
    const result = await Transport.claimLeg(req.params.legId, req.session.userId);

    try {
      await MessageThread.createOrGetForContext({
        contextType: 'transport_run',
        contextId: result.message_context.context_id,
        createdBy: req.session.userId,
        subject: `Transport: ${result.leg?.run_title || 'run'}`,
      });
    } catch (threadErr) {
      console.error('[Transport] claimLeg thread error:', threadErr.message);
    }

    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 400 || error.status === 403 || error.status === 404 || error.status === 409) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Transport] claimLeg error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function completeLeg(req, res) {
  try {
    if (!(await ensureApprovedVolunteer(req, res))) return;
    const body = req.body || {};
    const result = await Transport.completeLeg(req.params.legId, req.session.userId, {
      distanceMiles: body.distance_miles,
      notes: body.notes,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 400 || error.status === 403 || error.status === 404) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Transport] completeLeg error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function setExpenseClaimed(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const claimed =
      (req.body || {}).expense_claimed === true ||
      (req.body || {}).expense_claimed === 1 ||
      (req.body || {}).expense_claimed === '1';
    const leg = await Transport.setExpenseClaimed(req.params.legId, claimed);
    if (!leg) return res.status(404).json({ error: 'Leg not found' });
    return res.status(200).json(leg);
  } catch (error) {
    console.error('[Transport] setExpenseClaimed error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function mileageTotals(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const runId = req.query.run_id || null;
    const totals = await Transport.mileageTotalsByDriver(runId);
    return res.status(200).json(totals);
  } catch (error) {
    console.error('[Transport] mileageTotals error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function chaseCover(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const run = await Transport.findRunById(req.params.id);
    if (!run) return res.status(404).json({ error: 'Transport run not found' });
    if (['cancelled', 'completed', 'covered'].includes(run.status)) {
      return res.status(400).json({ error: 'Run does not need cover' });
    }
    if (!Transport.canReflagUrgent(run)) {
      return res.status(429).json({
        error: 'Urgent chase was already sent in the last 24 hours',
      });
    }

    const recipients = await Transport.resolveChaseRecipients(run.id, { limit: 200 });
    const whenLabel = String(run.run_date || '').slice(0, 10);
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await sendUrgentCover(recipient.email, {
          firstName: recipient.first_name,
          opportunityTitle: run.title || 'transport run',
          whenLabel,
          location: 'See Transport in ShelterLink for open legs',
        });
        sent += 1;
      } catch (emailError) {
        failed += 1;
        console.error('[Transport] chase email failed:', emailError.message);
      }
    }

    await Transport.markUrgentFlagged(run.id);
    await AdminMessage.createMessageLog({
      adminId: req.session.userId,
      subject: `Transport cover needed: ${run.title || 'run'}${whenLabel ? ` ${whenLabel}` : ''}`,
      body: `Chase sent for transport run #${run.id}`,
      filter: { type: 'transport_chase', run_id: run.id },
      recipientCount: sent,
    });

    return res.status(200).json({
      run_id: run.id,
      sent,
      failed,
      recipients: recipients.length,
    });
  } catch (error) {
    console.error('[Transport] chaseCover error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createRun,
  listRuns,
  getRun,
  updateRunStatus,
  listOpenLegs,
  listMyLegs,
  claimLeg,
  completeLeg,
  setExpenseClaimed,
  mileageTotals,
  chaseCover,
};
