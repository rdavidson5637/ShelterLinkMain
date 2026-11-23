'use strict';

const { pool } = require('../config/database');
const VolunteerHours = require('../models/VolunteerHours');
const Application = require('../models/Application');
const Badge = require('../models/Badge');
const {
  calculateStreakFromMonths,
  nextBadgeProgressFrom,
} = require('../utils/impactMath');

const { isStaffOrAdmin } = require('../middleware/auth');

function isAdmin(req) {
  return isStaffOrAdmin(req);
}

async function getApprovedHourMonths(userId) {
  const [rows] = await pool.execute(
    `
      SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') AS ym
      FROM volunteer_hours
      WHERE user_id = ?
        AND approved = 1
        AND date IS NOT NULL
      ORDER BY ym DESC
    `,
    [userId]
  );
  return rows.map((r) => r.ym);
}

/** Approved hours in a calendar year (existing volunteer_hours rows only). */
async function getApprovedHoursForYear(userId, year) {
  const [rows] = await pool.execute(
    `
      SELECT COALESCE(SUM(hours), 0) AS total_hours
      FROM volunteer_hours
      WHERE user_id = ?
        AND approved = 1
        AND EXTRACT(YEAR FROM date)::int = ?
    `,
    [userId, year]
  );
  return Number(rows[0]?.total_hours) || 0;
}

/**
 * Distinct shelters with approved hours for this volunteer.
 * Tenant RLS scopes the rows; the count is still a real column aggregate.
 */
async function countSheltersHelped(userId) {
  const [rows] = await pool.execute(
    `
      SELECT COUNT(DISTINCT shelter_id)::int AS cnt
      FROM volunteer_hours
      WHERE user_id = ?
        AND approved = 1
        AND shelter_id IS NOT NULL
    `,
    [userId]
  );
  return Number(rows[0]?.cnt) || 0;
}

/** Distinct training modules with a passing attempt. */
async function countTrainingCompleted(userId) {
  const [rows] = await pool.execute(
    `
      SELECT COUNT(DISTINCT module_id)::int AS cnt
      FROM training_attempts
      WHERE user_id = ?
        AND passed = 1
    `,
    [userId]
  );
  return Number(rows[0]?.cnt) || 0;
}

async function getAdminStats(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [volunteersResult] = await pool.execute(
      `SELECT COUNT(*) AS count 
       FROM users
       WHERE role = 'volunteer'`
    );
    const totalVolunteers = volunteersResult[0]?.count || 0;

    const [approvedResult] = await pool.execute(
      `SELECT COUNT(*) AS count 
       FROM volunteer_profiles 
       WHERE approved = 1`
    );
    const totalApprovedVolunteers = approvedResult[0]?.count || 0;

    const [pendingAppsResult] = await pool.execute(
      `SELECT COUNT(*) AS count 
       FROM applications 
       WHERE status = 'pending'`
    );
    const pendingApplications = pendingAppsResult[0]?.count || 0;

    const [activeOppsResult] = await pool.execute(
      "SELECT COUNT(*) AS count FROM opportunities WHERE status = 'open'"
    );
    const activeOpportunities = activeOppsResult[0]?.count || 0;

    const [monthHoursResult] = await pool.execute(
      `SELECT COALESCE(SUM(hours), 0) AS total_hours 
       FROM volunteer_hours 
       WHERE approved = 1
         AND EXTRACT(MONTH FROM date)::int = EXTRACT(MONTH FROM CURRENT_DATE)::int
         AND EXTRACT(YEAR FROM date)::int = EXTRACT(YEAR FROM CURRENT_DATE)::int`
    );
    const totalHoursThisMonth = monthHoursResult[0]?.total_hours || 0;

    const [allHoursResult] = await pool.execute(
      'SELECT COALESCE(SUM(hours), 0) AS total_hours FROM volunteer_hours WHERE approved = 1'
    );
    const totalHoursAllTime = allHoursResult[0]?.total_hours || 0;

    return res.status(200).json({
      totalVolunteers,
      totalApprovedVolunteers,
      pendingApplications,
      activeOpportunities,
      totalHoursThisMonth,
      totalHoursAllTime,
    });
  } catch (error) {
    console.error('[Stats] getAdminStats error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyImpactStats(req, res) {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = req.session.userId;
    const year = new Date().getFullYear();

    const [
      totalHoursRaw,
      hoursThisYear,
      shiftsCompleted,
      sheltersHelped,
      trainingCompleted,
      months,
      badges,
    ] = await Promise.all([
      VolunteerHours.getTotalHours(userId),
      getApprovedHoursForYear(userId, year),
      Application.countApprovedByUserId(userId),
      countSheltersHelped(userId),
      countTrainingCompleted(userId),
      getApprovedHourMonths(userId),
      Badge.calculateBadges(userId),
    ]);

    const totalHours = Number(totalHoursRaw) || 0;
    const currentStreak = calculateStreakFromMonths(months);
    const nextBadgeProgress = nextBadgeProgressFrom(badges.nextBadge);

    return res.status(200).json({
      hoursThisYear: Number(hoursThisYear) || 0,
      totalHours,
      shiftsCompleted: Number(shiftsCompleted) || 0,
      sheltersHelped: Number(sheltersHelped) || 0,
      trainingCompleted: Number(trainingCompleted) || 0,
      year,
      // Kept for the existing dashboard share card; the my-impact page does not show these.
      currentStreak,
      badges: {
        earned: badges.earned,
        locked: badges.locked,
        nextBadge: badges.nextBadge,
        nextBadgeProgress,
      },
    });
  } catch (error) {
    console.error('[Stats] getMyImpactStats error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getLeaderboard(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const [rows] = await pool.execute(
      `
        SELECT
          u.user_id,
          u.first_name,
          u.last_name,
          u.name,
          COALESCE(SUM(vh.hours), 0) AS total_hours
        FROM volunteer_hours vh
        INNER JOIN users u ON u.user_id = vh.user_id
        WHERE vh.approved = 1
          AND EXTRACT(YEAR FROM vh.date)::int = ?
        GROUP BY u.user_id, u.first_name, u.last_name, u.name
        ORDER BY total_hours DESC
        LIMIT 10
      `,
      [year]
    );

    return res.status(200).json(
      rows.map((r, i) => ({
        rank: i + 1,
        id: r.user_id,
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.name || 'Volunteer',
        total_hours: Number(r.total_hours) || 0,
      }))
    );
  } catch (error) {
    console.error('[Stats] getLeaderboard error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMonthlyHoursChart(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const [rows] = await pool.execute(
      `
        SELECT EXTRACT(MONTH FROM date)::int AS month, COALESCE(SUM(hours), 0) AS total_hours
        FROM volunteer_hours
        WHERE approved = 1
          AND EXTRACT(YEAR FROM date)::int = ?
        GROUP BY EXTRACT(MONTH FROM date)::int
        ORDER BY month ASC
      `,
      [year]
    );

    const byMonth = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      total_hours: 0,
    }));
    rows.forEach((r) => {
      const idx = Number(r.month) - 1;
      if (idx >= 0 && idx < 12) byMonth[idx].total_hours = Number(r.total_hours) || 0;
    });

    return res.status(200).json({ year, months: byMonth });
  } catch (error) {
    console.error('[Stats] getMonthlyHoursChart error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getAdminStats,
  getMyImpactStats,
  getLeaderboard,
  getMonthlyHoursChart,
  calculateStreakFromMonths,
  nextBadgeProgressFrom,
  getApprovedHoursForYear,
  countSheltersHelped,
  countTrainingCompleted,
};
