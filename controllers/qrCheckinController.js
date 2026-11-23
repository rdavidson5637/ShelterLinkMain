'use strict';

/**
 * Poster QR check-in (SL-NEXT-05).
 *
 * Staff print a poster for a shift. Its QR code opens
 * /pages/volunteer/checkin.html?shift=<id>#code=<code> on the volunteer's own
 * phone. The code sits in the URL fragment so it is never sent to the server
 * in a request line, access log or Referer header.
 *
 * Check-in and check-out reuse applicationController so the code, booking
 * status and time-window rules stay identical to the in-app and kiosk paths.
 */

const QRCode = require('qrcode');
const { pool } = require('../config/database');
const Application = require('../models/Application');
const Opportunity = require('../models/Opportunity');
const appCtrl = require('../controllers/applicationController');

const CHECKIN_PAGE = '/pages/volunteer/checkin.html';

function appOrigin(req) {
  const configured = String(process.env.APP_URL || '').trim();
  if (configured) {
    try {
      const u = new URL(configured);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch (_) {
      /* fall through to request host */
    }
  }
  const host = typeof req.get === 'function' ? req.get('host') : null;
  return `${req.protocol || 'https'}://${host || 'localhost'}`;
}

function buildCheckInUrl(origin, opportunityId, code) {
  return `${origin}${CHECKIN_PAGE}?shift=${encodeURIComponent(String(opportunityId))}#code=${encodeURIComponent(String(code))}`;
}

function stateOf(application) {
  if (!application) return 'not_booked';
  if (application.checked_out_at) return 'checked_out';
  if (application.checked_in_at) return 'checked_in';
  return 'ready';
}

async function findOwnAcceptedApplication(userId, opportunityId) {
  const [rows] = await pool.execute(
    `SELECT application_id
       FROM applications
      WHERE user_id = ?
        AND opportunity_id = ?
        AND status IN ('accepted', 'approved')
      ORDER BY application_id DESC
      LIMIT 1`,
    [userId, opportunityId]
  );
  if (!rows[0]) return null;
  return Application.findById(rows[0].application_id);
}

function serverError(res, label, error) {
  console.error(`[QrCheckin] ${label} error:`, error.message);
  if (error.status === 404) return res.status(404).json({ error: 'Not found' });
  return res.status(500).json({ error: 'Internal server error' });
}

/** Volunteer: what the check-in page should show for this shift. */
async function getShiftCheckInStatus(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const opportunityId = Number(req.params.id);

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) return res.status(404).json({ error: 'Shift not found' });

    const application = await findOwnAcceptedApplication(userId, opportunityId);
    return res.status(200).json({
      opportunity_id: opportunity.opportunity_id,
      title: opportunity.title,
      location: opportunity.location,
      start_date: opportunity.start_date,
      end_date: opportunity.end_date,
      state: stateOf(application),
      within_window: appCtrl.isWithinCheckInWindow(opportunity.start_date),
      checked_in_at: application?.checked_in_at || null,
      checked_out_at: application?.checked_out_at || null,
    });
  } catch (error) {
    return serverError(res, 'getShiftCheckInStatus', error);
  }
}

function delegate(handler, label) {
  return async function qrDelegate(req, res) {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: 'Authentication required' });
      const application = await findOwnAcceptedApplication(userId, Number(req.params.id));
      if (!application) {
        return res.status(404).json({ error: 'You do not have a confirmed place on this shift' });
      }
      const inner = Object.create(req);
      inner.params = { id: application.application_id };
      return handler(inner, res);
    } catch (error) {
      return serverError(res, label, error);
    }
  };
}

const qrCheckIn = delegate(appCtrl.checkInApplication, 'qrCheckIn');
const qrCheckOut = delegate(appCtrl.checkOutApplication, 'qrCheckOut');

async function loadPosterShift(req, res) {
  const opportunity = await Opportunity.findById(Number(req.params.id));
  if (!opportunity) {
    res.status(404).json({ error: 'Shift not found' });
    return null;
  }
  if (!opportunity.check_in_code) {
    res.status(409).json({ error: 'This shift has no check-in code' });
    return null;
  }
  return opportunity;
}

/** Staff: poster details for printing. */
async function getCheckInPoster(req, res) {
  try {
    const opportunity = await loadPosterShift(req, res);
    if (!opportunity) return undefined;
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      opportunity_id: opportunity.opportunity_id,
      title: opportunity.title,
      location: opportunity.location,
      start_date: opportunity.start_date,
      end_date: opportunity.end_date,
      check_in_code: opportunity.check_in_code,
      check_in_url: buildCheckInUrl(appOrigin(req), opportunity.opportunity_id, opportunity.check_in_code),
    });
  } catch (error) {
    return serverError(res, 'getCheckInPoster', error);
  }
}

/** Staff: the poster QR code as SVG. */
async function getCheckInPosterQr(req, res) {
  try {
    const opportunity = await loadPosterShift(req, res);
    if (!opportunity) return undefined;
    const url = buildCheckInUrl(appOrigin(req), opportunity.opportunity_id, opportunity.check_in_code);
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(svg);
  } catch (error) {
    return serverError(res, 'getCheckInPosterQr', error);
  }
}

module.exports = {
  getShiftCheckInStatus,
  qrCheckIn,
  qrCheckOut,
  getCheckInPoster,
  getCheckInPosterQr,
  buildCheckInUrl,
  appOrigin,
  CHECKIN_PAGE,
};
