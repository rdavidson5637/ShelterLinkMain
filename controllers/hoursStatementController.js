'use strict';

const VolunteerHours = require('../models/VolunteerHours');
const User = require('../models/User');
const ShelterBrand = require('../models/ShelterBrand');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function parseRange(query) {
  const startDate = query?.startDate ? String(query.startDate).trim() : '';
  const endDate = query?.endDate ? String(query.endDate).trim() : '';
  if (!startDate || !endDate) {
    return { error: 'startDate and endDate are required (YYYY-MM-DD)' };
  }
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return { error: 'Dates must be YYYY-MM-DD' };
  }
  if (startDate > endDate) {
    return { error: 'startDate must be on or before endDate' };
  }
  return { startDate, endDate };
}

function signedOffByRole(sessionRole, { staffIssued }) {
  if (staffIssued) {
    if (sessionRole === 'admin') return 'Administrator';
    if (sessionRole === 'staff') return 'Staff';
    return 'Staff';
  }
  // Volunteer-opened statement: hours are already staff-approved.
  return 'Shelter staff';
}

async function buildStatement({ userId, startDate, endDate, signedOffBy }) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Volunteer not found');
    err.status = 404;
    throw err;
  }

  const [hoursBlock, brand] = await Promise.all([
    VolunteerHours.findApprovedStatement(userId, { startDate, endDate }),
    ShelterBrand.getPublicBrand().catch(() => null),
  ]);

  return {
    volunteer: {
      user_id: Number(userId),
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Volunteer',
    },
    start_date: startDate,
    end_date: endDate,
    total_hours: Number(hoursBlock.total_hours) || 0,
    shift_count: Number(hoursBlock.shift_count) || 0,
    shifts: hoursBlock.shifts,
    shelter: {
      name: (brand && brand.name) || 'Shelter',
      has_logo: Boolean(brand && brand.hasLogo),
    },
    signed_off_by: {
      role: signedOffBy,
    },
  };
}

async function getMyHoursStatement(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const range = parseRange(req.query || {});
    if (range.error) return res.status(400).json({ error: range.error });

    const statement = await buildStatement({
      userId: req.session.userId,
      startDate: range.startDate,
      endDate: range.endDate,
      signedOffBy: signedOffByRole(req.session.role, { staffIssued: false }),
    });
    return res.status(200).json(statement);
  } catch (error) {
    console.error('[HoursStatement] getMyHoursStatement error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerHoursStatement(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ error: 'Invalid volunteer id' });
    }

    const range = parseRange(req.query || {});
    if (range.error) return res.status(400).json({ error: range.error });

    const statement = await buildStatement({
      userId,
      startDate: range.startDate,
      endDate: range.endDate,
      signedOffBy: signedOffByRole(req.session.role, { staffIssued: true }),
    });
    return res.status(200).json(statement);
  } catch (error) {
    console.error('[HoursStatement] getVolunteerHoursStatement error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getMyHoursStatement,
  getVolunteerHoursStatement,
  parseRange,
  signedOffByRole,
  buildStatement,
};
