'use strict';

const GroupBooking = require('../models/GroupBooking');
const Opportunity = require('../models/Opportunity');
const {
  sendGroupBookingReceived,
  sendGroupBookingConfirmed,
  sendGroupBookingDeclined,
} = require('../utils/emailService');
const { isStaffOrAdmin } = require('../middleware/auth');

function ensureStaff(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function createGroupBooking(req, res) {
  try {
    const {
      opportunity_id: opportunityId,
      group_name: groupName,
      contact_name: contactName,
      contact_email: contactEmail,
      size,
      notes,
    } = req.body || {};

    if (!opportunityId || !groupName || !contactName || !contactEmail || size == null) {
      return res.status(400).json({
        error: 'opportunity_id, group_name, contact_name, contact_email, and size are required',
      });
    }

    const groupSize = Number(size);
    if (!Number.isInteger(groupSize) || groupSize < 1) {
      return res.status(400).json({ error: 'size must be a positive integer' });
    }

    if (!isValidEmail(contactEmail)) {
      return res.status(400).json({ error: 'contact_email is invalid' });
    }

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity || opportunity.status !== 'open') {
      return res.status(404).json({ error: 'Opportunity not found or not open' });
    }

    const booking = await GroupBooking.create({
      opportunityId: Number(opportunityId),
      groupName: String(groupName).trim(),
      contactName: String(contactName).trim(),
      contactEmail: String(contactEmail).trim().toLowerCase(),
      size: groupSize,
      notes: notes ? String(notes).trim() : null,
    });

    try {
      await sendGroupBookingReceived(booking.contact_email, {
        contactName: booking.contact_name,
        groupName: booking.group_name,
        opportunityTitle: booking.opportunity_title,
        size: booking.size,
      });
    } catch (emailError) {
      console.error('[GroupBooking] create email error:', emailError.message);
    }

    return res.status(201).json(booking);
  } catch (error) {
    console.error('[GroupBooking] createGroupBooking error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listGroupBookings(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const status = req.query.status || null;
    const rows = await GroupBooking.findAll({ status });
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[GroupBooking] listGroupBookings error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function confirmGroupBooking(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const { id } = req.params;
    const booking = await GroupBooking.findById(id);
    if (!booking) {
      return res.status(404).json({ error: 'Group booking not found' });
    }
    if (booking.status === 'confirmed') {
      return res.status(200).json(booking);
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Cancelled bookings cannot be confirmed' });
    }

    const opportunity = await Opportunity.findById(booking.opportunity_id);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const maxVolunteers = Number(opportunity.max_volunteers);
    if (Number.isFinite(maxVolunteers) && maxVolunteers > 0) {
      const current = await Opportunity.getCurrentCapacity(booking.opportunity_id);
      if (current + Number(booking.size) > maxVolunteers) {
        return res.status(400).json({
          error: 'Confirming this group would exceed opportunity capacity',
          capacity: current,
          max_volunteers: maxVolunteers,
          group_size: booking.size,
        });
      }
    }

    const updated = await GroupBooking.updateStatus(id, 'confirmed');

    try {
      await sendGroupBookingConfirmed(updated.contact_email, {
        contactName: updated.contact_name,
        groupName: updated.group_name,
        opportunityTitle: updated.opportunity_title,
        startDate: updated.opportunity_start_date,
      });
    } catch (emailError) {
      console.error('[GroupBooking] confirm email error:', emailError.message);
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error('[GroupBooking] confirmGroupBooking error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function declineGroupBooking(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const { id } = req.params;
    const booking = await GroupBooking.findById(id);
    if (!booking) {
      return res.status(404).json({ error: 'Group booking not found' });
    }
    if (booking.status === 'cancelled') {
      return res.status(200).json(booking);
    }

    const updated = await GroupBooking.updateStatus(id, 'cancelled');

    try {
      await sendGroupBookingDeclined(updated.contact_email, {
        contactName: updated.contact_name,
        groupName: updated.group_name,
        opportunityTitle: updated.opportunity_title,
      });
    } catch (emailError) {
      console.error('[GroupBooking] decline email error:', emailError.message);
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error('[GroupBooking] declineGroupBooking error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createGroupBooking,
  listGroupBookings,
  confirmGroupBooking,
  declineGroupBooking,
};
