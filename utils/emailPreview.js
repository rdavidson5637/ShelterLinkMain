'use strict';

/**
 * Read-only email preview catalog for shelter admins (SL-LATER-38).
 * Renders sample HTML + plain text for the current shelter. Never sends mail.
 */

const { currentShelterId } = require('./shelterContext');
const {
  brandBits,
  currentShelterName,
  buildBookingConfirmed,
  buildApplicationApproval,
  buildShiftReminder,
  buildWaitlistSeatOffer,
  buildVolunteerSetPasswordInvite,
  buildWeeklyDigest,
  buildPasswordReset,
  buildNoShowFollowUp,
} = require('./emailService');

const APP_BASE = () => String(process.env.APP_URL || 'https://shelterlink.online').replace(/\/$/, '');

function sampleData(shelterNamePlain) {
  const base = APP_BASE();
  return {
    opportunityTitle: 'Morning kennel walk',
    reminder: {
      title: 'Morning kennel walk',
      date: 'Saturday 28 November',
      time: '09:00 - 12:00',
      location: shelterNamePlain ? `${shelterNamePlain} yard` : 'Shelter yard',
    },
    waitlist: {
      title: 'Afternoon dog enrichment',
      claimLink: `${base}/pages/volunteer/claim-waitlist.html?token=sample-preview-token`,
      hours: 12,
    },
    invite: {
      firstName: 'Alex',
      link: `${base}/reset-password.html?token=sample-invite-token`,
      expiresInDays: 7,
      shelterNamePlain,
    },
    digest: {
      name: 'Alex',
      myShifts: [
        {
          title: 'Morning kennel walk',
          when: 'Sat 28 Nov, 09:00',
          location: shelterNamePlain ? `${shelterNamePlain} yard` : 'Shelter yard',
        },
      ],
      openShifts: [
        {
          title: 'Afternoon dog enrichment',
          when: 'Sun 29 Nov, 14:00',
          location: 'Enrichment room',
        },
      ],
      fosterMatches: [],
      unreadCount: 1,
    },
    reset: {
      firstName: 'Alex',
      link: `${base}/reset-password.html?token=sample-reset-token`,
      shelterName: shelterNamePlain,
    },
    noShow: {
      volunteerName: 'Alex',
      opportunityTitle: 'Morning kennel walk',
      shiftDate: '2026-11-15T09:00:00.000Z',
      message: 'Hope you are well. Let us know if you would like another shift.',
    },
  };
}

const CATALOG = [
  {
    id: 'booking',
    label: 'Booking confirmed',
    description: 'Sent when a volunteer is booked on a shift.',
    build(brand, samples) {
      return buildBookingConfirmed(samples.opportunityTitle, brand);
    },
  },
  {
    id: 'approval',
    label: 'Application approved',
    description: 'Sent when staff approve a pending application.',
    build(brand, samples) {
      return buildApplicationApproval(samples.opportunityTitle, brand);
    },
  },
  {
    id: 'reminder',
    label: 'Shift reminder',
    description: 'Reminder before an accepted shift.',
    build(brand, samples) {
      return buildShiftReminder(samples.reminder, brand);
    },
  },
  {
    id: 'waitlist_offer',
    label: 'Waitlist seat offer',
    description: 'Timed claim link when a place frees on a full shift.',
    build(brand, samples) {
      return buildWaitlistSeatOffer(samples.waitlist, brand);
    },
  },
  {
    id: 'invite',
    label: 'Set-password invite',
    description: 'Invite for an imported volunteer to choose a password.',
    build(brand, samples) {
      return buildVolunteerSetPasswordInvite(samples.invite, brand);
    },
  },
  {
    id: 'digest',
    label: 'Weekly digest',
    description: 'Week-ahead shifts, open gaps, and unread messages.',
    build(brand, samples) {
      return buildWeeklyDigest(samples.digest, brand);
    },
  },
  {
    id: 'reset',
    label: 'Password reset',
    description: 'Forgot-password link. Expires in one hour.',
    build(brand, samples) {
      return buildPasswordReset(samples.reset, brand);
    },
  },
  {
    id: 'noshow_followup',
    label: 'No-show follow-up',
    description: 'Staff-triggered email after a missed shift. Never auto-sent.',
    build(brand, samples) {
      return buildNoShowFollowUp(samples.noShow, brand);
    },
  },
];

/**
 * Render every catalogued template with sample data for the current shelter.
 * Does not send mail.
 */
async function renderEmailPreviews() {
  const shelterId = currentShelterId();
  if (!shelterId) {
    const err = new Error('Shelter context required');
    err.status = 403;
    throw err;
  }

  const brand = await brandBits();
  const shelterName = brand.namePlain || (await currentShelterName()) || '';
  const samples = sampleData(shelterName);

  const previews = CATALOG.map((item) => {
    const parts = item.build(brand, samples);
    return {
      id: item.id,
      label: item.label,
      description: item.description,
      subject: parts.subject,
      html: parts.html,
      text: parts.text,
    };
  });

  return {
    shelter: {
      id: shelterId,
      name: shelterName,
    },
    sends_mail: false,
    previews,
  };
}

function catalogIds() {
  return CATALOG.map((item) => item.id);
}

module.exports = {
  CATALOG,
  catalogIds,
  sampleData,
  renderEmailPreviews,
};
