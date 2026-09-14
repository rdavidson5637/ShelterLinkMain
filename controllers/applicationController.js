const Application = require('../models/Application');
const VolunteerProfile = require('../models/VolunteerProfile');
const Opportunity = require('../models/Opportunity');
const User = require('../models/User');
const VolunteerHours = require('../models/VolunteerHours');
const Qualification = require('../models/Qualification');
const Waiver = require('../models/Waiver');
const SwapRequest = require('../models/SwapRequest');
const MessageThread = require('../models/MessageThread');
const Animal = require('../models/Animal');
const Vetting = require('../models/Vetting');
const { isWithinCancellationCutoff } = require('../utils/cancellationRules');
const {
  sendEmail,
  sendApplicationConfirmation,
  sendApplicationApproval,
  sendApplicationCancellation,
  sendApplicationRejection,
  sendWaitlistPromotion,
} = require('../utils/emailService');
const { isStaffOrAdmin } = require('../middleware/auth');
const { isTestOrE2EOpportunity } = require('../utils/testOpportunityGuard');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function isAdmin(req) {
  // Staff and admin share application management privileges.
  return isStaffOrAdmin(req);
}

function isAcceptedStatus(status) {
  return status === 'accepted' || status === 'approved';
}

/**
 * Promote the oldest waitlisted application to pending and notify the volunteer.
 * Optionally reopen a capacity-closed opportunity when a seat is available.
 */
async function promoteOldestWaitlisted(opportunityId) {
  if (!opportunityId) return null;

  const waitlisted = await Application.findOldestWaitlisted(opportunityId);
  if (!waitlisted) return null;

  const promoted = await Application.updateStatus(waitlisted.application_id, 'pending');
  if (!promoted) return null;

  try {
    const email = promoted.email || waitlisted.email;
    if (email) {
      await sendWaitlistPromotion(
        email,
        promoted.opportunity_title || waitlisted.opportunity_title || 'Opportunity'
      );
    }
  } catch (emailError) {
    console.error('[Application] promoteOldestWaitlisted email error:', emailError.message);
  }

  const opportunity = await Opportunity.findById(opportunityId);
  if (opportunity && opportunity.status === 'closed') {
    const maxVolunteers = Number(opportunity.max_volunteers);
    const capacity = await Opportunity.getCurrentCapacity(opportunityId);
    if (!Number.isFinite(maxVolunteers) || maxVolunteers <= 0 || capacity < maxVolunteers) {
      await Opportunity.updateStatus(opportunityId, 'open');
    }
  }

  return promoted;
}

async function applyForOpportunity(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const { opportunityId } = req.body || {};

    if (!opportunityId) {
      return res.status(400).json({ error: 'opportunityId is required' });
    }

    const profile = await VolunteerProfile.findByUserId(userId);
    if (!profile) {
      return res.status(403).json({ error: 'Please complete your volunteer profile before applying.' });
    }

    if (!profile.approved) {
      return res.status(403).json({ error: 'Your profile is pending approval. You can apply for shifts once an admin has approved your profile.' });
    }

    const pendingWaivers = await Waiver.findPendingForUser(userId);
    if (pendingWaivers.length) {
      const titles = pendingWaivers.map((w) => w.title).join(', ');
      return res.status(403).json({
        error: `You must accept the following waiver(s) before applying: ${titles}`,
        pending_waivers: pendingWaivers.map((w) => ({
          id: w.id,
          title: w.title,
          version: w.version,
        })),
      });
    }

    const existing = await Application.checkExisting(userId, opportunityId);
    if (existing) {
      return res.status(409).json({ error: 'You have already applied for this opportunity' });
    }

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    if (process.env.NODE_ENV === 'production' && isTestOrE2EOpportunity(opportunity)) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const missingQuals = await Qualification.findMissingForUser(userId, opportunityId);
    if (missingQuals.length) {
      const names = missingQuals.map((q) => q.name).join(', ');
      return res.status(403).json({
        error: `You are missing required qualifications (or they have expired): ${names}`,
        missing_qualifications: missingQuals,
      });
    }

    const missingAnimalQuals = await Animal.findMissingQualificationsForUser(
      userId,
      opportunityId
    );
    if (missingAnimalQuals.length) {
      const detail = missingAnimalQuals
        .map((m) => `${m.animal_name} (${m.qualification_name})`)
        .join(', ');
      return res.status(403).json({
        error: `You need additional qualifications for animals on this shift: ${detail}`,
        missing_animal_qualifications: missingAnimalQuals,
      });
    }

    const requiredCheck = opportunity.required_background_check_type;
    if (requiredCheck) {
      const hasClear = await Vetting.hasClearCheck(userId, requiredCheck);
      if (!hasClear) {
        return res.status(403).json({
          error: `This opportunity requires a clear ${requiredCheck.replace(/_/g, ' ')} background check before you can apply.`,
          required_background_check_type: requiredCheck,
        });
      }
    }

    const maxVolunteers = Number(opportunity.max_volunteers);
    const hasCap = Number.isFinite(maxVolunteers) && maxVolunteers > 0;
    const currentApprovedCount = hasCap
      ? await Opportunity.getCurrentCapacity(opportunityId)
      : 0;
    const isFull = hasCap && currentApprovedCount >= maxVolunteers;

    // Open opportunities always accept; capacity-closed ones still accept waitlist joins.
    const waitlistEligibleClosed = opportunity.status === 'closed' && isFull;
    if (opportunity.status && opportunity.status !== 'open' && !waitlistEligibleClosed) {
      return res.status(400).json({
        error: 'This opportunity is no longer open for applications.',
      });
    }

    const initialStatus = isFull ? 'waitlisted' : 'pending';
    const createdApplication = await Application.create(userId, opportunityId, initialStatus);

    try {
      const volunteerEmail = profile?.user_email || (await User.findById(userId))?.email;
      const opportunityTitle = opportunity?.title || createdApplication?.title || 'Opportunity';

      if (volunteerEmail) {
        await sendApplicationConfirmation(volunteerEmail, opportunityTitle);
      }

      const adminNotifyEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
      if (adminNotifyEmail) {
        const statusNote = initialStatus === 'waitlisted' ? ' (waitlisted)' : '';
        await sendEmail(
          adminNotifyEmail,
          'New Volunteer Application Submitted',
          `
            <p>A new application has been submitted${statusNote}.</p>
            <p><strong>Opportunity:</strong> ${opportunityTitle}<br/>
            <strong>Volunteer ID:</strong> ${userId}</p>
          `
        );
      }
    } catch (emailError) {
      console.error('[Application] applyForOpportunity email error:', emailError.message);
    }

    return res.status(201).json({
      message:
        initialStatus === 'waitlisted'
          ? 'Added to the waitlist successfully'
          : 'Application submitted successfully',
      status: initialStatus,
      application: createdApplication,
    });
  } catch (error) {
    console.error('[Application] applyForOpportunity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyApplications(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    const applications = await Application.findByUserId(userId);
    return res.status(200).json(applications);
  } catch (error) {
    console.error('[Application] getMyApplications error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAllApplications(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { status } = req.query || {};
    const filters = {};
    if (status) {
      filters.status = status;
    }

    const applications = await Application.findAll(filters);
    return res.status(200).json(applications);
  } catch (error) {
    console.error('[Application] getAllApplications error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateApplicationStatus(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const { status, notes } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    if (!['accepted', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be accepted, rejected, or pending' });
    }

    const existingApplication = await Application.findById(id);
    if (!existingApplication) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const isAccepting = status === 'accepted';
    const alreadyAccepted = isAcceptedStatus(existingApplication.status);
    const wasAccepted = isAcceptedStatus(existingApplication.status);

    if (isAccepting && !alreadyAccepted) {
      const opportunity = await Opportunity.findById(existingApplication.opportunity_id);
      if (!opportunity) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }

      const maxVolunteers = Number(opportunity.max_volunteers);
      if (Number.isFinite(maxVolunteers) && maxVolunteers > 0) {
        const currentApprovedCount = await Opportunity.getCurrentCapacity(existingApplication.opportunity_id);
        if (currentApprovedCount >= maxVolunteers) {
          return res.status(400).json({ error: 'This opportunity is at full capacity' });
        }
      }
    }

    // Pass rejection reason through to model
    const rejectionReason = status === 'rejected' ? (notes || null) : null;
    const application = await Application.updateStatus(id, status, rejectionReason);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Keep opportunity open when full so volunteers can still join the waitlist.
    // Soft-close only if an admin has already closed it — do not auto-close on fill.

    // Send status emails
    try {
      if (application.email) {
        if (status === 'accepted' || status === 'approved') {
          await sendApplicationApproval(application.email, application.opportunity_title || 'Opportunity');
        } else if (status === 'rejected') {
          await sendApplicationRejection(
            application.email,
            application.opportunity_title || 'Opportunity',
            rejectionReason
          );
        }
      }
    } catch (emailError) {
      console.error('[Application] updateApplicationStatus email error:', emailError.message);
    }

    if (status === 'rejected' && wasAccepted) {
      await promoteOldestWaitlisted(application.opportunity_id);
      try {
        await MessageThread.removeParticipantForOpportunity(
          application.opportunity_id,
          application.user_id
        );
      } catch (threadError) {
        console.error('[Application] revoke thread access error:', threadError.message);
      }
    }

    return res.status(200).json(application);
  } catch (error) {
    console.error('[Application] updateApplicationStatus error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function cancelApplication(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const applicationId = req.params.id;
    const userId = req.session.userId;
    const admin = isAdmin(req);

    const existing = await Application.findById(applicationId);
    if (!existing) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (!admin && Number(existing.user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!admin && isAcceptedStatus(existing.status)) {
      const opportunity = await Opportunity.findById(existing.opportunity_id);
      const cutoff = Number(opportunity?.cancellation_cutoff_hours ?? 24);
      if (isWithinCancellationCutoff(opportunity?.start_date, cutoff)) {
        return res.status(400).json({
          error: 'Too close to the shift to cancel. Please request a swap instead.',
          must_request_swap: true,
          cancellation_cutoff_hours: cutoff,
        });
      }
    }

    const result = await Application.cancelApplication(applicationId, userId, { asAdmin: admin });

    if (!result) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (result.invalidStatus) {
      return res.status(400).json({ error: 'Application cannot be cancelled in its current status' });
    }

    const priorStatus = result.prior_status;
    const freedSeat = isAcceptedStatus(priorStatus);

    try {
      await SwapRequest.cancelOpenForApplication(applicationId);
    } catch (swapError) {
      console.error('[Application] cancel open swap error:', swapError.message);
    }

    try {
      if (result.email) {
        await sendApplicationCancellation(
          result.email,
          result.opportunity_title || 'Opportunity'
        );
      }
    } catch (emailError) {
      console.error('[Application] cancelApplication email error:', emailError.message);
    }

    if (freedSeat) {
      await promoteOldestWaitlisted(result.opportunity_id);
      try {
        await MessageThread.removeParticipantForOpportunity(result.opportunity_id, result.user_id);
      } catch (threadError) {
        console.error('[Application] revoke thread access error:', threadError.message);
      }
    }

    return res.status(200).json({ message: 'Cancellation confirmed' });
  } catch (error) {
    console.error('[Application] cancelApplication error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function markApplicationNoShow(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const application = await Application.findById(id);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (!isAcceptedStatus(application.status)) {
      return res.status(400).json({ error: 'Only accepted applications can be marked as no-show' });
    }

    const start = application.opportunity_start_date || application.opportunity_end_date;
    if (!start) {
      return res.status(400).json({ error: 'Opportunity date is missing' });
    }
    const startDate = new Date(start);
    const endOfStartDay = new Date(startDate);
    endOfStartDay.setHours(23, 59, 59, 999);
    if (Number.isNaN(startDate.getTime()) || endOfStartDay >= new Date()) {
      return res.status(400).json({ error: 'No-show can only be marked for past opportunities' });
    }

    const updated = await Application.markNoShow(id, true);
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[Application] markApplicationNoShow error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function isWithinCheckInWindow(opportunityStart, now = new Date()) {
  const start = new Date(opportunityStart);
  if (Number.isNaN(start.getTime())) return false;
  const windowStart = new Date(start.getTime() - 60 * 60 * 1000);
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 59, 999);
  return now >= windowStart && now <= endOfDay;
}

async function checkInApplication(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const { id } = req.params;
    const code = String(req.body?.code || '').trim().toUpperCase();

    if (!code) {
      return res.status(400).json({ error: 'Check-in code is required' });
    }

    const application = await Application.findById(id);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    if (Number(application.user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isAcceptedStatus(application.status)) {
      return res.status(400).json({ error: 'Only accepted applications can check in' });
    }
    if (application.checked_in_at) {
      return res.status(400).json({ error: 'Already checked in' });
    }
    if (!application.check_in_code || application.check_in_code.toUpperCase() !== code) {
      return res.status(400).json({ error: 'Incorrect check-in code' });
    }
    if (!isWithinCheckInWindow(application.opportunity_start_date)) {
      return res.status(400).json({ error: 'Check-in is only available from 1 hour before the shift until end of day' });
    }

    const updated = await Application.setCheckIn(id);
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[Application] checkInApplication error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function checkOutApplication(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const { id } = req.params;
    const code = String(req.body?.code || '').trim().toUpperCase();

    if (!code) {
      return res.status(400).json({ error: 'Check-in code is required' });
    }

    const application = await Application.findById(id);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    if (Number(application.user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!application.checked_in_at) {
      return res.status(400).json({ error: 'Check in before checking out' });
    }
    if (application.checked_out_at) {
      return res.status(400).json({ error: 'Already checked out' });
    }
    if (!application.check_in_code || application.check_in_code.toUpperCase() !== code) {
      return res.status(400).json({ error: 'Incorrect check-in code' });
    }
    if (!isWithinCheckInWindow(application.opportunity_start_date)) {
      return res.status(400).json({ error: 'Check-out is only available until end of the shift day' });
    }

    const updated = await Application.setCheckOut(id);
    if (!updated) {
      return res.status(400).json({ error: 'Unable to check out' });
    }

    const inAt = new Date(updated.checked_in_at);
    const outAt = new Date(updated.checked_out_at);
    const rawHours = (outAt.getTime() - inAt.getTime()) / (1000 * 60 * 60);
    const hours = Application.roundHoursToQuarter(Math.max(rawHours, 0));
    const date = String(updated.opportunity_start_date || updated.checked_in_at).slice(0, 10);

    let hoursRecord = null;
    if (hours > 0) {
      hoursRecord = await VolunteerHours.create(
        userId,
        updated.opportunity_id,
        date,
        hours,
        { verified_by_checkin: true }
      );
    }

    return res.status(200).json({ application: updated, hours: hoursRecord });
  } catch (error) {
    console.error('[Application] checkOutApplication error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  applyForOpportunity,
  getMyApplications,
  getAllApplications,
  updateApplicationStatus,
  cancelApplication,
  promoteOldestWaitlisted,
  markApplicationNoShow,
  checkInApplication,
  checkOutApplication,
  isWithinCheckInWindow,
};
