'use strict';

const { pool } = require('../config/database');
const { sendWeeklyDigest } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'weeklyDigest';

function startOfIsoWeek(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfIsoWeek(date) {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return end;
}

function isoWeekKey(date) {
  const start = startOfIsoWeek(date);
  return start.toISOString().slice(0, 10);
}

function formatWhen(value) {
  if (!value) return 'TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString();
}

async function hasDigestForUserThisWeek(userId, weekKey) {
  const [rows] = await pool.execute(
    `
      SELECT 1
      FROM job_runs
      WHERE job_name = ?
        AND status = 'ok'
        AND detail LIKE ?
      LIMIT 1
    `,
    [JOB_NAME, `%user_id=${userId};week=${weekKey}%`]
  );
  return rows.length > 0;
}

async function findApprovedRecipients() {
  const [rows] = await pool.execute(
    `
      SELECT
        u.user_id,
        u.email,
        u.first_name,
        u.last_name,
        vp.availability,
        vp.away_until
      FROM users u
      INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.role = 'volunteer'
        AND COALESCE(vp.approved, 0) = 1
        AND u.email IS NOT NULL
        AND u.email <> ''
        AND (vp.away_until IS NULL OR vp.away_until < CURRENT_DATE)
      ORDER BY u.user_id ASC
    `
  );
  return rows;
}

async function myShiftsThisWeek(userId, weekStart, weekEnd) {
  const [rows] = await pool.execute(
    `
      SELECT o.opportunity_id, o.title, o.start_date, o.end_date, o.location
      FROM applications a
      INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.user_id = ?
        AND a.status IN ('accepted', 'approved')
        AND o.start_date >= ?
        AND o.start_date < ?
      ORDER BY o.start_date ASC
    `,
    [userId, weekStart, weekEnd]
  );
  return rows;
}

async function openMatchingShifts(userId, weekStart, weekEnd) {
  // Open understaffed shifts this week the volunteer has not already applied for.
  const [rows] = await pool.execute(
    `
      SELECT o.opportunity_id, o.title, o.start_date, o.location
      FROM opportunities o
      WHERE o.status = 'open'
        AND o.start_date >= ?
        AND o.start_date < ?
        AND NOT EXISTS (
          SELECT 1 FROM applications a
          WHERE a.user_id = ? AND a.opportunity_id = o.opportunity_id
        )
      ORDER BY o.start_date ASC
      LIMIT 10
    `,
    [weekStart, weekEnd, userId]
  );
  return rows;
}

async function buildDigestPayload(user, weekStart, weekEnd) {
  const myShifts = await myShiftsThisWeek(user.user_id, weekStart, weekEnd);
  const openShifts = await openMatchingShifts(user.user_id, weekStart, weekEnd);

  let fosterMatches = [];
  try {
    const Foster = require('../models/Foster');
    if (Foster && typeof Foster.listOpenMatchingForUser === 'function') {
      fosterMatches = await Foster.listOpenMatchingForUser(user.user_id);
    }
  } catch (error) {
    console.error('[Job:weeklyDigest] foster matches skipped:', error.message);
  }

  let unreadCount = 0;
  try {
    const MessageThread = require('../models/MessageThread');
    if (MessageThread && typeof MessageThread.unreadCountForUser === 'function') {
      unreadCount = await MessageThread.unreadCountForUser(user.user_id, { isStaff: false });
    }
  } catch (error) {
    console.error('[Job:weeklyDigest] unread count skipped:', error.message);
  }

  return {
    name: user.first_name || 'there',
    myShifts: myShifts.map((s) => ({
      title: s.title,
      when: formatWhen(s.start_date),
      location: s.location || 'TBA',
    })),
    openShifts: openShifts.map((s) => ({
      title: s.title,
      when: formatWhen(s.start_date),
      location: s.location || 'TBA',
    })),
    fosterMatches: fosterMatches.slice(0, 5).map((f) => ({
      animalName: f.animal_name || 'Foster animal',
      urgency: f.urgency || 'planned',
      neededFrom: f.needed_from ? String(f.needed_from).slice(0, 10) : 'TBA',
    })),
    unreadCount: Number(unreadCount) || 0,
  };
}

/**
 * Monday morning digest for approved, non-away volunteers.
 * Dedupes with job_runs detail user_id=…;week=YYYY-MM-DD (Monday).
 */
async function runWeeklyDigest(options = {}) {
  const now = options.now || new Date();
  const weekStart = startOfIsoWeek(now);
  const weekEnd = endOfIsoWeek(now);
  const weekKey = isoWeekKey(now);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  let recipients = [];
  try {
    recipients = await findApprovedRecipients();
  } catch (error) {
    console.error('[Job:weeklyDigest] recipient query failed:', error.message);
    try {
      await recordJobRun(JOB_NAME, 'error', `query_failed:${error.message}`);
    } catch (_) {
      /* ignore */
    }
    return { sent: 0, skipped: 0, failed: 1, detail: error.message };
  }

  for (const user of recipients) {
    try {
      if (await hasDigestForUserThisWeek(user.user_id, weekKey)) {
        skipped += 1;
        continue;
      }
      const payload = await buildDigestPayload(user, weekStart, weekEnd);
      await sendWeeklyDigest(user.email, payload);
      await recordJobRun(
        JOB_NAME,
        'ok',
        `user_id=${user.user_id};week=${weekKey}`
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error('[Job:weeklyDigest] failed for user', user.user_id, error.message);
    }
  }

  const detail = `sent=${sent};skipped=${skipped};failed=${failed};candidates=${recipients.length};week=${weekKey}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:weeklyDigest] summary job_runs log failed:', logError.message);
  }

  return { sent, skipped, failed, detail, weekKey };
}

module.exports = {
  JOB_NAME,
  runWeeklyDigest,
  startOfIsoWeek,
  endOfIsoWeek,
  isoWeekKey,
  hasDigestForUserThisWeek,
  findApprovedRecipients,
  buildDigestPayload,
};
