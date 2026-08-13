'use strict';

const Application = require('../models/Application');
const Opportunity = require('../models/Opportunity');
const VolunteerProfile = require('../models/VolunteerProfile');
const Qualification = require('../models/Qualification');
const Waiver = require('../models/Waiver');
const SwapRequest = require('../models/SwapRequest');
const {
  sendSwapOpened,
  sendSwapWaitlistOffer,
  sendSwapClaimedToOriginal,
  sendSwapClaimedToClaimer,
} = require('../utils/emailService');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function isAcceptedStatus(status) {
  return status === 'accepted' || status === 'approved';
}

function appUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function requestSwap(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const applicationId = req.params.id;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    if (Number(application.user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isAcceptedStatus(application.status)) {
      return res.status(400).json({ error: 'Only accepted applications can be swapped' });
    }

    const existing = await SwapRequest.findOpenByApplicationId(applicationId);
    if (existing) {
      return res.status(409).json({ error: 'A swap request is already open for this application', swap: existing });
    }

    const opportunity = await Opportunity.findById(application.opportunity_id);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const waitlisted = await Application.findOldestWaitlisted(application.opportunity_id);
    let swap;
    let waitlistOffered = false;

    if (waitlisted && Number(waitlisted.user_id) !== Number(userId)) {
      const token = SwapRequest.generateClaimToken();
      const expiresAt = SwapRequest.addHours(new Date(), SwapRequest.WAITLIST_OFFER_HOURS);
      swap = await SwapRequest.create(applicationId, {
        waitlistOfferedToUserId: waitlisted.user_id,
        waitlistOfferExpiresAt: expiresAt,
        claimToken: token,
        publicAt: null,
      });
      waitlistOffered = true;

      try {
        const email = waitlisted.email;
        if (email) {
          const claimLink = `${appUrl(req)}/pages/volunteer/claim-swap.html?token=${token}`;
          await sendSwapWaitlistOffer(email, {
            title: opportunity.title,
            claimLink,
            hours: SwapRequest.WAITLIST_OFFER_HOURS,
          });
        }
      } catch (emailError) {
        console.error('[Swap] waitlist offer email error:', emailError.message);
      }
    } else {
      swap = await SwapRequest.create(applicationId, {
        publicAt: new Date(),
      });
    }

    try {
      if (application.email) {
        await sendSwapOpened(application.email, opportunity.title || 'Opportunity');
      }
    } catch (emailError) {
      console.error('[Swap] opened email error:', emailError.message);
    }

    return res.status(201).json({
      message: waitlistOffered
        ? 'Swap opened. The oldest waitlisted volunteer has 12 hours to claim first.'
        : 'Swap opened. Other qualifying volunteers can cover this shift.',
      swap,
      waitlist_offered: waitlistOffered,
    });
  } catch (error) {
    console.error('[Swap] requestSwap error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listAvailableSwaps(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    await SwapRequest.publishExpiredWaitlistOffers();
    const swaps = await SwapRequest.findOpenPublic();

    const enriched = [];
    for (const swap of swaps) {
      if (Number(swap.original_user_id) === Number(userId)) continue;

      const missing = await Qualification.findMissingForUser(userId, swap.opportunity_id);
      enriched.push({
        ...swap,
        missing_qualifications: missing,
        can_claim: missing.length === 0,
      });
    }

    return res.status(200).json(enriched);
  } catch (error) {
    console.error('[Swap] listAvailableSwaps error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function assertClaimerEligible(userId, opportunityId) {
  const profile = await VolunteerProfile.findByUserId(userId);
  if (!profile) {
    return { error: 'Please complete your volunteer profile before claiming a shift.', status: 403 };
  }
  if (!profile.approved) {
    return { error: 'Your profile must be approved before claiming a shift.', status: 403 };
  }

  const pendingWaivers = await Waiver.findPendingForUser(userId);
  if (pendingWaivers.length) {
    const titles = pendingWaivers.map((w) => w.title).join(', ');
    return {
      error: `You must accept the following waiver(s) before claiming: ${titles}`,
      status: 403,
      pending_waivers: pendingWaivers,
    };
  }

  const missingQuals = await Qualification.findMissingForUser(userId, opportunityId);
  if (missingQuals.length) {
    const names = missingQuals.map((q) => q.name).join(', ');
    return {
      error: `You are missing required qualifications (or they have expired): ${names}`,
      status: 403,
      missing_qualifications: missingQuals,
    };
  }

  return { ok: true };
}

async function finalizeClaim(result) {
  const title = result.opportunityTitle || 'Opportunity';
  try {
    if (result.original?.email) {
      await sendSwapClaimedToOriginal(result.original.email, title);
    }
  } catch (emailError) {
    console.error('[Swap] claim email (original) error:', emailError.message);
  }
  try {
    if (result.claimerApplication?.email) {
      await sendSwapClaimedToClaimer(result.claimerApplication.email, title);
    }
  } catch (emailError) {
    console.error('[Swap] claim email (claimer) error:', emailError.message);
  }

  const claimerName =
    result.claimerApplication?.name ||
    [result.claimerApplication?.first_name, result.claimerApplication?.last_name].filter(Boolean).join(' ') ||
    `user #${result.claimerApplication?.user_id}`;
  const originalName =
    result.original?.name ||
    [result.original?.first_name, result.original?.last_name].filter(Boolean).join(' ') ||
    `user #${result.original?.user_id}`;

  try {
    await Opportunity.appendActivityNote(
      result.opportunityId,
      `Shift swap claimed: ${originalName} cancelled; ${claimerName} accepted (swap #${result.swap?.id}).`
    );
  } catch (noteError) {
    console.error('[Swap] activity note error:', noteError.message);
  }
}

function mapClaimError(error, res) {
  const code = error.code;
  if (code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
  if (code === 'NOT_OPEN' || code === 'NOT_PUBLIC' || code === 'BAD_TOKEN' || code === 'OWN_SWAP' || code === 'ALREADY_ACCEPTED' || code === 'RACE') {
    return res.status(400).json({ error: error.message });
  }
  console.error('[Swap] claim error:', error.message);
  return res.status(500).json({ error: 'Internal server error' });
}

async function claimSwap(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const swapId = req.params.id;

    const swap = await SwapRequest.findById(swapId);
    if (!swap) {
      return res.status(404).json({ error: 'Swap not found' });
    }

    const eligibility = await assertClaimerEligible(userId, swap.opportunity_id);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({
        error: eligibility.error,
        missing_qualifications: eligibility.missing_qualifications,
        pending_waivers: eligibility.pending_waivers,
      });
    }

    await SwapRequest.publishExpiredWaitlistOffers();

    const result = await SwapRequest.claimAtomically(swapId, userId);
    await finalizeClaim(result);

    return res.status(200).json({
      message: 'Shift claimed successfully',
      swap: result.swap,
      application: result.claimerApplication,
    });
  } catch (error) {
    return mapClaimError(error, res);
  }
}

async function claimSwapByToken(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const token = String(req.body?.token || req.query?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    const swap = await SwapRequest.findByClaimToken(token);
    if (!swap) {
      return res.status(404).json({ error: 'Invalid or expired claim link' });
    }
    if (Number(swap.waitlist_offered_to_user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'This claim link was sent to a different volunteer' });
    }

    const eligibility = await assertClaimerEligible(userId, swap.opportunity_id);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({
        error: eligibility.error,
        missing_qualifications: eligibility.missing_qualifications,
        pending_waivers: eligibility.pending_waivers,
      });
    }

    const result = await SwapRequest.claimAtomically(swap.id, userId, { viaToken: token });
    await finalizeClaim(result);

    return res.status(200).json({
      message: 'Shift claimed successfully from waitlist offer',
      swap: result.swap,
      application: result.claimerApplication,
    });
  } catch (error) {
    return mapClaimError(error, res);
  }
}

async function cancelSwap(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const swapId = req.params.id;

    const result = await SwapRequest.cancelById(swapId, userId);
    if (!result) {
      return res.status(404).json({ error: 'Swap not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (result.invalidStatus) {
      return res.status(400).json({ error: 'Swap cannot be cancelled in its current status' });
    }
    return res.status(200).json({ message: 'Swap cancelled', swap: result });
  } catch (error) {
    console.error('[Swap] cancelSwap error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  requestSwap,
  listAvailableSwaps,
  claimSwap,
  claimSwapByToken,
  cancelSwap,
};
