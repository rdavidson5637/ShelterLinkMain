'use strict';

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');

/**
 * Same error the API gives for a route that does not exist, so a non-owner
 * cannot tell /api/platform/* apart from an unknown path.
 */
function notFoundError() {
  return { type: 'not_found', message: 'API endpoint not found' };
}

/**
 * True when the user id is in platform_owners. platform_owners is global
 * and separate from users.role: a shelter admin is not a platform owner.
 */
async function isPlatformOwnerUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT user_id FROM platform_owners WHERE user_id = ? LIMIT 1',
    [id]
  ));
  return rows.length > 0;
}

/**
 * Gate for every /api/platform route. Anyone who is not a platform owner,
 * signed in or not, gets 404, never 401 or 403. Kiosk sessions never pass.
 */
async function isPlatformOwner(req, res, next) {
  try {
    const session = req.session || {};
    if (!session.userId || session.kioskMode) return next(notFoundError());
    if (!(await isPlatformOwnerUser(session.userId))) return next(notFoundError());
    req.platformOwnerId = Number(session.userId);
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Page version of the gate, for /platform/* HTML routes. A non-owner gets
 * the normal 404 page with status 404, same as any unknown page.
 */
function isPlatformOwnerPage(notFoundPage) {
  return async function platformOwnerPage(req, res, next) {
    try {
      const session = req.session || {};
      const ok = session.userId && !session.kioskMode
        && (await isPlatformOwnerUser(session.userId));
      res.set('Cache-Control', 'no-store');
      if (!ok) return res.status(404).sendFile(notFoundPage);
      req.platformOwnerId = Number(session.userId);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  isPlatformOwner,
  isPlatformOwnerPage,
  isPlatformOwnerUser,
  notFoundError,
};
