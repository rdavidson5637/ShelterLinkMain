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
      SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS ym
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
         AND MONTH(date) = MONTH(CURRENT_DATE) 
         AND YEAR(date) = YEAR(CURRENT_DATE)`
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
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyImpactStats(req, res) {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = req.session.userId;

    const [totalHoursRaw, shiftsCompleted, months, badges] = await Promise.all([
      VolunteerHours.getTotalHours(userId),
      Application.countApprovedByUserId(userId),
      getApprovedHourMonths(userId),
      Badge.calculateBadges(userId),
    ]);

    const totalHours = Number(totalHoursRaw) || 0;
    const currentStreak = calculateStreakFromMonths(months);
    const nextBadgeProgress = nextBadgeProgressFrom(badges.nextBadge);

    return res.status(200).json({
      totalHours,
      shiftsCompleted: Number(shiftsCompleted) || 0,
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
          AND YEAR(vh.date) = ?
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
        SELECT MONTH(date) AS month, COALESCE(SUM(hours), 0) AS total_hours
        FROM volunteer_hours
        WHERE approved = 1
          AND YEAR(date) = ?
        GROUP BY MONTH(date)
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
};
