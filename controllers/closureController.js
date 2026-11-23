'use strict';

/**
 * Shelter closure dates (SL-LATER-30).
 *   GET    /api/admin/closures                      staff or admin
 *   POST   /api/admin/closures                      admin only
 *   GET    /api/admin/closures/:closureId/affected  staff or admin
 *   DELETE /api/admin/closures/:closureId           admin only
 *   GET    /api/opportunities/closures              any signed-in user
 *   GET    /api/public/closures                     public board
 *
 * Adding a closure never cancels or emails anyone. The response lists shifts
 * inside it that already have bookings, so staff can close each one through
 * the existing close-shift path (DELETE /api/opportunities/:id).
 */

const ShelterClosure = require('../models/ShelterClosure');
const { parseClosureInput, closureOn, dayOf, closedDayMessage } = require('../utils/closureDates');
const { publicShelterId } = require('../middleware/shelter');
const { runWithShelter } = require('../utils/shelterContext');

function publicClosure(c) {
  return { starts_on: c.starts_on, ends_on: c.ends_on, reason: c.reason };
}

async function listClosures(req, res) {
  try {
    const includePast = String(req.query?.include_past || '') === 'true';
    const closures = await ShelterClosure.list({ includePast });
    return res.status(200).json({ closures });
  } catch (error) {
    console.error('[Closures] listClosures error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createClosure(req, res) {
  try {
    const parsed = parseClosureInput(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const closure = await ShelterClosure.create(parsed.value, req.session.userId);
    if (!closure) return res.status(500).json({ error: 'Internal server error' });
    const affected = await ShelterClosure.bookedShiftsBetween(closure.starts_on, closure.ends_on);
    return res.status(201).json({
      message: affected.length
        ? `Closure saved. ${affected.length} shift${affected.length === 1 ? ' has' : 's have'} bookings inside it. Nothing has been cancelled.`
        : 'Closure saved. No booked shifts fall inside it.',
      closure,
      affected_shifts: affected,
    });
  } catch (error) {
    console.error('[Closures] createClosure error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAffectedShifts(req, res) {
  try {
    const closure = await ShelterClosure.findById(Number(req.params.closureId));
    if (!closure) return res.status(404).json({ error: 'Closure not found' });
    const affected = await ShelterClosure.bookedShiftsBetween(closure.starts_on, closure.ends_on);
    return res.status(200).json({ closure, affected_shifts: affected });
  } catch (error) {
    console.error('[Closures] getAffectedShifts error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteClosure(req, res) {
  try {
    const removed = await ShelterClosure.remove(Number(req.params.closureId));
    if (!removed) return res.status(404).json({ error: 'Closure not found' });
    return res.status(200).json({ message: 'Closure removed' });
  } catch (error) {
    console.error('[Closures] deleteClosure error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listUpcomingClosures(req, res) {
  try {
    const closures = await ShelterClosure.list({ includePast: false });
    return res.status(200).json(closures.map(publicClosure));
  } catch (error) {
    console.error('[Closures] listUpcomingClosures error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listPublicClosures(req, res) {
  try {
    const shelterId = await publicShelterId(req);
    if (!shelterId) return res.status(404).json({ error: 'Not found' });
    const closures = await runWithShelter(shelterId, () => ShelterClosure.list({ includePast: false }));
    return res.status(200).json(closures.map(publicClosure));
  } catch (error) {
    console.error('[Closures] listPublicClosures error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Closures that cover any of these shift start days, for the current shelter.
 * Returns [] on error so a closure lookup never breaks a shift list.
 */
async function closuresForDays(days) {
  const sorted = (days || []).map(dayOf).filter(Boolean).sort();
  if (!sorted.length) return [];
  try {
    return await ShelterClosure.findOverlapping(sorted[0], sorted[sorted.length - 1]);
  } catch (error) {
    console.error('[Closures] closuresForDays error:', error.message);
    return [];
  }
}

/** Adds closed_reason to each shift that starts on a closed day. */
async function markClosedShifts(opportunities) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  if (!list.length) return list;
  const closures = await closuresForDays(list.map((o) => o.start_date));
  if (!closures.length) return list;
  return list.map((o) => {
    const closure = closureOn(closures, o.start_date);
    return closure ? { ...o, closed_reason: closure.reason } : o;
  });
}

/**
 * First closed day among these shift start dates, or null. Used to refuse a
 * new shift or a repeating series. Lookup errors propagate so a shift is not
 * created when the check could not run.
 */
async function firstClosedDay(startDates) {
  const days = [...new Set((startDates || []).map(dayOf).filter(Boolean))].sort();
  if (!days.length) return null;
  const closures = await ShelterClosure.findOverlapping(days[0], days[days.length - 1]);
  for (const day of days) {
    const closure = closureOn(closures, day);
    if (closure) {
      return { day, closure, message: closedDayMessage(closure, day) };
    }
  }
  return null;
}

module.exports = {
  listClosures,
  createClosure,
  getAffectedShifts,
  deleteClosure,
  listUpcomingClosures,
  listPublicClosures,
  markClosedShifts,
  firstClosedDay,
};
