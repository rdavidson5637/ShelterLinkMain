'use strict';

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { clearSessionCookie } = require('../utils/sessionCookie');
const Application = require('../models/Application');
const VolunteerHours = require('../models/VolunteerHours');
const { hasRole } = require('../middleware/auth');

function respondSafeUser(row) {
  if (!row) return null;
  const { password, reset_token, reset_token_expires, ...safe } = row;
  return safe;
}

function displayName(firstName, lastName) {
  const first = String(firstName || '').trim() || 'Volunteer';
  const last = String(lastName || '').trim();
  const initial = last ? `${last.charAt(0).toUpperCase()}.` : '';
  return initial ? `${first} ${initial}` : first;
}

function isWithinCheckInWindow(opportunityStart, now = new Date()) {
  const start = new Date(opportunityStart);
  if (Number.isNaN(start.getTime())) return false;
  const windowStart = new Date(start.getTime() - 60 * 60 * 1000);
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 59, 999);
  return now >= windowStart && now <= endOfDay;
}

function isAcceptedStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'accepted' || s === 'approved';
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const toSql = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { startSql: toSql(start), endSql: toSql(end) };
}

async function unlockKiosk(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await pool.execute(
      `SELECT user_id, first_name, last_name, name, email, password, role, created_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(String(password), String(user.password));
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!hasRole({ session: { role: user.role }, user }, 'staff', 'admin')) {
      return res.status(403).json({ error: 'Only staff or admin can unlock kiosk mode' });
    }

    req.session.userId = user.user_id;
    req.session.role = user.role;
    req.session.kioskMode = true;

    return res.status(200).json({
      kiosk: true,
      user: respondSafeUser(user),
    });
  } catch (error) {
    console.error('[Kiosk] unlockKiosk error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getKioskStatus(req, res) {
  try {
    if (!req.session?.kioskMode || !req.session?.userId) {
      return res.status(401).json({ error: 'Kiosk locked', kiosk: false });
    }
    return res.status(200).json({
      kiosk: true,
      userId: req.session.userId,
      role: req.session.role,
    });
  } catch (error) {
    console.error('[Kiosk] getKioskStatus error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listTodayShifts(req, res) {
  try {
    if (!req.session?.kioskMode) {
      return res.status(403).json({ error: 'Kiosk session required' });
    }

    const { startSql, endSql } = todayBounds();
    const [opps] = await pool.execute(
      `
        SELECT
          o.opportunity_id,
          o.title,
          o.location,
          o.start_date,
          o.end_date
        FROM opportunities o
        WHERE o.status IN ('open', 'closed', 'completed')
          AND o.start_date >= ?
          AND o.start_date <= ?
        ORDER BY o.start_date ASC, o.opportunity_id ASC
      `,
      [startSql, endSql]
    );

    const shifts = [];
    for (const opp of opps) {
      const [apps] = await pool.execute(
        `
          SELECT
            a.application_id,
            a.status,
            a.checked_in_at,
            a.checked_out_at,
            u.first_name,
            u.last_name
          FROM applications a
          INNER JOIN users u ON u.user_id = a.user_id
          WHERE a.opportunity_id = ?
            AND a.status IN ('accepted', 'approved')
          ORDER BY u.first_name ASC, u.last_name ASC
        `,
        [opp.opportunity_id]
      );

      shifts.push({
        id: opp.opportunity_id,
        opportunity_id: opp.opportunity_id,
        title: opp.title,
        location: opp.location,
        start_date: opp.start_date,
        end_date: opp.end_date,
        volunteers: apps.map((a) => ({
          application_id: a.application_id,
          id: a.application_id,
          display_name: displayName(a.first_name, a.last_name),
          checked_in_at: a.checked_in_at,
          checked_out_at: a.checked_out_at,
          state: a.checked_out_at
            ? 'checked_out'
            : a.checked_in_at
              ? 'checked_in'
              : 'ready',
        })),
      });
    }

    return res.status(200).json(shifts);
  } catch (error) {
    console.error('[Kiosk] listTodayShifts error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function kioskCheckIn(req, res) {
  try {
    if (!req.session?.kioskMode) {
      return res.status(403).json({ error: 'Kiosk session required' });
    }

    const { id } = req.params;
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: 'Check-in code is required' });
    }

    const application = await Application.findById(id);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
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
      return res.status(400).json({
        error: 'Check-in is only available from 1 hour before the shift until end of day',
      });
    }

    const updated = await Application.setCheckIn(id);
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[Kiosk] kioskCheckIn error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function kioskCheckOut(req, res) {
  try {
    if (!req.session?.kioskMode) {
      return res.status(403).json({ error: 'Kiosk session required' });
    }

    const { id } = req.params;
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: 'Check-in code is required' });
    }

    const application = await Application.findById(id);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
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
      return res.status(400).json({
        error: 'Check-out is only available until end of the shift day',
      });
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
        updated.user_id,
        updated.opportunity_id,
        date,
        hours,
        { verified_by_checkin: true }
      );
    }

    return res.status(200).json({ application: updated, hours: hoursRecord });
  } catch (error) {
    console.error('[Kiosk] kioskCheckOut error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function lockKiosk(req, res) {
  try {
    if (!req.session) {
      return res.status(200).json({ message: 'Kiosk locked', kiosk: false });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to lock kiosk' });
      }
      clearSessionCookie(res);
      return res.status(200).json({ message: 'Kiosk locked', kiosk: false });
    });
  } catch (error) {
    console.error('[Kiosk] lockKiosk error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  unlockKiosk,
  getKioskStatus,
  listTodayShifts,
  kioskCheckIn,
  kioskCheckOut,
  lockKiosk,
  displayName,
  isWithinCheckInWindow,
};
