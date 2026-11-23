'use strict';

/**
 * Shelter supplies wishlist endpoints (SL-DAY-18).
 *   GET    /api/wishlist
 *   POST   /api/wishlist
 *   PUT    /api/wishlist/:id
 *   POST   /api/wishlist/:id/archive
 *   GET    /api/public/wishlist
 *
 * Staff manage items. The public shelter page lists active items and an
 * updated_on date. No payments or donation processing.
 */

const ShelterWishlistItem = require('../models/ShelterWishlistItem');
const { isAdminUser } = require('../middleware/auth');
const { publicShelterId } = require('../middleware/shelter');
const { runWithShelter } = require('../utils/shelterContext');

function isStaffOrAdmin(req) {
  const role = req.session?.role;
  return role === 'staff' || role === 'admin' || isAdminUser(req);
}

async function listWishlist(req, res) {
  try {
    const staff = isStaffOrAdmin(req);
    const wantAll =
      staff &&
      (req.query?.all === '1' ||
        req.query?.all === 'true' ||
        req.query?.archived === '1' ||
        req.query?.archived === 'true');
    const includeArchived =
      staff &&
      (req.query?.archived === '1' ||
        req.query?.archived === 'true' ||
        req.query?.all === '1' ||
        req.query?.all === 'true');
    const items = await ShelterWishlistItem.listItems({
      activeOnly: !wantAll,
      includeArchived,
    });
    return res.status(200).json({
      items,
      total: items.length,
      updated_on: ShelterWishlistItem.updatedOnFrom(items),
    });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Wishlist] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createWishlistItem(req, res) {
  try {
    const item = await ShelterWishlistItem.create({
      name: req.body?.name,
      quantity: req.body?.quantity,
      priority: req.body?.priority,
      note: req.body?.note,
      createdBy: req.session?.userId || null,
    });
    return res.status(201).json({ message: 'Wishlist item added', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Wishlist] create error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateWishlistItem(req, res) {
  try {
    const item = await ShelterWishlistItem.update(req.params.id, {
      name: req.body?.name,
      quantity: req.body?.quantity,
      priority: req.body?.priority,
      note: req.body?.note,
    });
    return res.status(200).json({ message: 'Wishlist item updated', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Wishlist] update error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function archiveWishlistItem(req, res) {
  try {
    const item = await ShelterWishlistItem.archive(req.params.id);
    return res.status(200).json({ message: 'Wishlist item archived', item });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Wishlist] archive error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listPublicWishlist(req, res) {
  try {
    const shelterId = await publicShelterId(req);
    if (!shelterId) return res.status(404).json({ error: 'Not found' });
    const payload = await runWithShelter(shelterId, () => ShelterWishlistItem.listPublic());
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[Wishlist] listPublic error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listWishlist,
  createWishlistItem,
  updateWishlistItem,
  archiveWishlistItem,
  listPublicWishlist,
};
