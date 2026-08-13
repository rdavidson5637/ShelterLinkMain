const { findById } = require('../models/User');

async function attachUser(req) {
  if (!req.session || !req.session.userId) return null;
  try {
    const user = await findById(req.session.userId);
    if (user) {
      // Prefer live DB role over session so role changes take effect immediately.
      req.user = { ...user, role: user.role || req.session.role };
      if (user.role && req.session.role !== user.role) {
        req.session.role = user.role;
      }
      return req.user;
    }
  } catch (_) {
    // Ignore attach errors; auth checks will handle responses
  }
  return null;
}

function sessionRole(req) {
  return (req.user && req.user.role) || (req.session && req.session.role) || null;
}

/**
 * True when the session/user has one of the given roles.
 */
function hasRole(req, ...roles) {
  const role = sessionRole(req);
  return Boolean(role && roles.includes(role));
}

function isStaffOrAdmin(req) {
  return hasRole(req, 'staff', 'admin');
}

function isAdminUser(req) {
  return hasRole(req, 'admin');
}

async function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await attachUser(req);
  return next();
}

/**
 * Require the authenticated user to have one of the listed roles.
 * Usage: requireRole('admin') or requireRole('staff', 'admin')
 */
function requireRole(...roles) {
  if (!roles.length) {
    throw new Error('requireRole expects at least one role');
  }
  return async function requireRoleMiddleware(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await attachUser(req);
    if (!hasRole(req, ...roles)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

/** @deprecated Prefer requireRole('admin'); kept for older imports. */
const isAdmin = requireRole('admin');

/** Staff or admin — day-to-day ops (opportunities, applications, hours). */
const requireStaff = requireRole('staff', 'admin');

/**
 * True when this session was unlocked as a tablet kiosk.
 */
function isKioskSession(req) {
  return Boolean(req.session && req.session.kioskMode);
}

/**
 * Require an active kiosk session (set via POST /api/kiosk/unlock).
 */
async function requireKiosk(req, res, next) {
  if (!isKioskSession(req)) {
    return res.status(403).json({ error: 'Kiosk session required' });
  }
  return next();
}

/**
 * Block kiosk sessions from non-kiosk API routes.
 * Mount early on /api so a tablet unlock cannot call admin endpoints.
 */
function restrictKioskSession(req, res, next) {
  if (!isKioskSession(req)) return next();
  const path = req.path || '';
  // When mounted at /api, req.path is relative (e.g. /kiosk/shifts, /admin/stats).
  const isKioskPath =
    path === '/kiosk' ||
    path.startsWith('/kiosk/') ||
    // Allow unlock/status even if already flagged (re-unlock / lock).
    path.startsWith('/kiosk');
  if (isKioskPath) return next();
  return res.status(403).json({ error: 'Kiosk session cannot access this endpoint' });
}

module.exports = {
  attachUser,
  isAuthenticated,
  requireRole,
  requireStaff,
  isAdmin,
  hasRole,
  isStaffOrAdmin,
  isAdminUser,
  sessionRole,
  isKioskSession,
  requireKiosk,
  restrictKioskSession,
};
