'use strict';

/**
 * Admin endpoints for the per-shelter booking policy (SL-NOW-03).
 *   GET  /api/admin/settings/booking            staff or admin
 *   PUT  /api/admin/settings/booking            admin only
 *   PUT  /api/admin/volunteers/:userId/trusted  admin only
 * Every mutation goes through auditMutations on the admin router.
 */

const BookingPolicy = require('../models/BookingPolicy');
const User = require('../models/User');

function trustedRow(row) {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.name || row.email || '';
  return {
    user_id: row.user_id,
    name,
    email: row.email || null,
    granted_at: row.granted_at || null,
  };
}

async function getBookingSettings(req, res) {
  try {
    const policy = await BookingPolicy.getPolicy();
    const trusted = await BookingPolicy.listTrusted();
    return res.status(200).json({
      booking_mode: policy.booking_mode,
      updated_at: policy.updated_at,
      trusted_volunteers: trusted.map(trustedRow),
    });
  } catch (error) {
    console.error('[BookingPolicy] getBookingSettings error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateBookingSettings(req, res) {
  try {
    const { booking_mode: mode } = req.body || {};
    const policy = await BookingPolicy.setMode(mode, req.session.userId);
    return res.status(200).json({
      message:
        policy.booking_mode === 'instant'
          ? 'Trusted volunteers now book instantly'
          : 'Every booking now waits for staff approval',
      booking_mode: policy.booking_mode,
      updated_at: policy.updated_at,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[BookingPolicy] updateBookingSettings error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateVolunteerTrusted(req, res) {
  try {
    const userId = Number(req.params.userId);
    const { trusted } = req.body || {};

    const user = await User.findById(userId);
    if (!user || (user.role && user.role !== 'volunteer')) {
      return res.status(404).json({ error: 'Volunteer not found' });
    }

    if (trusted) {
      await BookingPolicy.grantTrust(userId, req.session.userId);
    } else {
      await BookingPolicy.revokeTrust(userId);
    }
    return res.status(200).json({
      message: trusted ? 'Volunteer marked as trusted' : 'Trusted status removed',
      user_id: userId,
      trusted: Boolean(trusted),
    });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Volunteer not found' });
    console.error('[BookingPolicy] updateVolunteerTrusted error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getBookingSettings,
  updateBookingSettings,
  updateVolunteerTrusted,
};
