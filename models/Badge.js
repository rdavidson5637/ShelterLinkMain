const VolunteerHours = require('./VolunteerHours');
const Application = require('./Application');

/**
 * Code-defined badges (no database table).
 * A badge is earned when totalHours >= hoursNeeded (if hoursNeeded > 0)
 * and approvedApplications >= shiftsNeeded (if shiftsNeeded > 0).
 */
const BADGES = [
  {
    id: 'first_step',
    label: 'First Step',
    emoji: '👣',
    description: 'Complete your first volunteer shift (approved application).',
    hoursNeeded: 0,
    shiftsNeeded: 1,
  },
  {
    id: 'dedicated_helper',
    label: 'Dedicated Helper',
    emoji: '🌟',
    description: 'Reach 10 approved hours of service.',
    hoursNeeded: 10,
    shiftsNeeded: 0,
  },
  {
    id: 'regular_volunteer',
    label: 'Regular Volunteer',
    emoji: '🤝',
    description: 'Reach 25 approved hours of service.',
    hoursNeeded: 25,
    shiftsNeeded: 0,
  },
  {
    id: 'community_hero',
    label: 'Community Hero',
    emoji: '🦸',
    description: 'Reach 50 approved hours of service.',
    hoursNeeded: 50,
    shiftsNeeded: 0,
  },
  {
    id: 'super_volunteer',
    label: 'Super Volunteer',
    emoji: '🏆',
    description: 'Reach 100 approved hours of service.',
    hoursNeeded: 100,
    shiftsNeeded: 0,
  },
];

function isEarned(badge, totalHours, approvedApplications) {
  const hoursOk = badge.hoursNeeded <= 0 || totalHours >= badge.hoursNeeded;
  const shiftsOk = badge.shiftsNeeded <= 0 || approvedApplications >= badge.shiftsNeeded;
  return hoursOk && shiftsOk;
}

function progressNote(badge, totalHours, approvedApplications) {
  if (badge.shiftsNeeded > 0) {
    const need = Math.max(0, badge.shiftsNeeded - approvedApplications);
    if (need === 0) return null;
    return need === 1
      ? 'Get approved for 1 more shift to unlock this badge.'
      : `Get approved for ${need} more shifts to unlock this badge.`;
  }
  if (badge.hoursNeeded > 0) {
    const need = Math.max(0, badge.hoursNeeded - totalHours);
    if (need === 0) return null;
    const cur = Math.min(totalHours, badge.hoursNeeded);
    return `Log ${need} more approved hour${need === 1 ? '' : 's'} (${cur} of ${badge.hoursNeeded}).`;
  }
  return null;
}

function publicBadge(badge) {
  return {
    id: badge.id,
    label: badge.label,
    emoji: badge.emoji,
    description: badge.description,
    hoursNeeded: badge.hoursNeeded,
    shiftsNeeded: badge.shiftsNeeded,
  };
}

function buildNextBadge(firstLocked, totalHours, approvedApplications) {
  if (!firstLocked) return null;

  const isShiftBadge = firstLocked.shiftsNeeded > 0;
  const hoursNeeded = firstLocked.hoursNeeded;
  const currentProgress = isShiftBadge ? approvedApplications : totalHours;

  return {
    id: firstLocked.id,
    label: firstLocked.label,
    hoursNeeded,
    shiftsNeeded: firstLocked.shiftsNeeded,
    currentProgress,
  };
}

/**
 * Computes badges from live hours and application data (nothing persisted).
 * @param {number|string} userId
 * @returns {Promise<{ earned: object[], locked: object[], nextBadge: object|null }>}
 */
async function calculateBadges(userId) {
  const [totalHoursRaw, approvedApplications] = await Promise.all([
    VolunteerHours.getTotalHours(userId),
    Application.countApprovedByUserId(userId),
  ]);

  const totalHours = Number(totalHoursRaw) || 0;
  const approvedCount = Number(approvedApplications) || 0;

  const earned = [];
  const locked = [];

  for (const badge of BADGES) {
    if (isEarned(badge, totalHours, approvedCount)) {
      earned.push(publicBadge(badge));
    } else {
      const note = progressNote(badge, totalHours, approvedCount);
      locked.push({
        ...publicBadge(badge),
        progressNote: note || 'Keep volunteering to unlock this badge.',
      });
    }
  }

  const firstLocked = BADGES.find((b) => !isEarned(b, totalHours, approvedCount));
  const nextBadge = buildNextBadge(firstLocked, totalHours, approvedCount);

  return { earned, locked, nextBadge };
}

module.exports = {
  BADGES,
  calculateBadges,
};
