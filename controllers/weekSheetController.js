'use strict';

const DaySheet = require('../models/DaySheet');
const { recordAudit } = require('../middleware/auditLog');
const { isStaffOrAdmin } = require('../middleware/auth');
// Reuse the one fixed implementation instead of keeping a second copy that
// can drift (this file used to have its own, buggier duplicate).
const { buildVCalendar, toIcalDate } = require('./publicController');
const { todayIso } = require('../utils/shelterTime');

function mondayOf(dateOnly) {
  const d = new Date(`${dateOnly}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function resolveWeekStart(query) {
  const raw = (query && query.week_start) || mondayOf(todayIso());
  return raw;
}

async function auditWeekView(req, sheet) {
  try {
    await recordAudit(req, {
      action: 'week_sheet.view',
      entityType: 'week_sheet',
      entityId: sheet.week_start,
      detail: {
        week_start: sheet.week_start,
        week_end: sheet.week_end,
        opportunity_count: sheet.opportunities.length,
      },
    });
  } catch (auditError) {
    console.error('[WeekSheet] audit error:', auditError.message);
  }
}

async function loadWeekSheet(req) {
  if (!isStaffOrAdmin(req)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const weekStart = resolveWeekStart(req.query);
  if (!DaySheet.isValidDateOnly(weekStart)) {
    const err = new Error('week_start must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  if (!DaySheet.isMonday(weekStart)) {
    const err = new Error('week_start must be a Monday');
    err.status = 400;
    throw err;
  }

  return DaySheet.getForWeek(weekStart);
}

async function getWeekSheet(req, res) {
  try {
    const sheet = await loadWeekSheet(req);
    await auditWeekView(req, sheet);
    return res.status(200).json(sheet);
  } catch (error) {
    console.error('[WeekSheet] getWeekSheet error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
    if (error.status === 400 || /week_start must be/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getWeekSheetIcs(req, res) {
  try {
    const sheet = await loadWeekSheet(req);
    await auditWeekView(req, sheet);

    const events = sheet.opportunities
      .map((opp) => {
        const startRaw = opp.start_date;
        const endRaw = opp.end_date || opp.start_date;
        const startHasTime =
          String(startRaw || '').includes(':') || String(startRaw || '').includes('T');
        const start = toIcalDate(startRaw);
        let end = toIcalDate(endRaw);
        const allDay = !startHasTime;
        if (allDay && start) {
          const endDate = new Date(`${String(endRaw).slice(0, 10)}T00:00:00Z`);
          endDate.setUTCDate(endDate.getUTCDate() + 1);
          end = toIcalDate(endDate.toISOString().slice(0, 10));
        }
        if (!start) return null;

        const names = (opp.volunteers || [])
          .map((v) => v.name || `${v.first_name || ''} ${v.last_name || ''}`.trim())
          .filter(Boolean)
          .join(', ');
        const description = [
          names ? `Accepted: ${names}` : 'No accepted volunteers yet',
          opp.check_in_code ? `Check-in code: ${opp.check_in_code}` : null,
          opp.location ? `Location: ${opp.location}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          uid: `week-sheet-opportunity-${opp.opportunity_id || opp.id}@shelterlink`,
          start,
          end,
          allDay,
          summary: opp.title || 'Volunteer shift',
          description,
          location: opp.location || '',
        };
      })
      .filter(Boolean);

    const body = buildVCalendar(
      events,
      `ShelterLink Week ${sheet.week_start}`
    );
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="shelterlink-week-${sheet.week_start}.ics"`
    );
    return res.status(200).send(body);
  } catch (error) {
    console.error('[WeekSheet] getWeekSheetIcs error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
    if (error.status === 400 || /week_start must be/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getWeekSheet,
  getWeekSheetIcs,
};
