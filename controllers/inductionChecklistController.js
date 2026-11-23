'use strict';

/**
 * Induction checklist endpoints (SL-DAY-02).
 *   GET/POST       /api/induction-checklist/items
 *   POST           /api/induction-checklist/items/starter
 *   PUT/DELETE     /api/induction-checklist/items/:id
 *   GET            /api/induction-checklist/me
 *   GET            /api/admin/volunteers/:userId/induction
 *   PUT            /api/admin/volunteers/:userId/induction/:itemId
 */

const InductionChecklist = require('../models/InductionChecklist');

async function listItems(req, res) {
  try {
    const activeOnly =
      req.query?.active === '1' ||
      req.query?.active === 'true' ||
      req.query?.activeOnly === '1';
    const items = await InductionChecklist.listItems({ activeOnly });
    return res.status(200).json({ items, total: items.length });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Induction] listItems error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createItem(req, res) {
  try {
    const item = await InductionChecklist.createItem({
      title: req.body?.title,
      sort_order: req.body?.sort_order,
    });
    return res.status(201).json({ message: 'Checklist item added', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Induction] createItem error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateItem(req, res) {
  try {
    const item = await InductionChecklist.updateItem(Number(req.params.id), {
      title: req.body?.title,
      sort_order: req.body?.sort_order,
      active: req.body?.active,
    });
    return res.status(200).json({ message: 'Checklist item updated', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Induction] updateItem error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteItem(req, res) {
  try {
    const result = await InductionChecklist.deleteItem(Number(req.params.id));
    return res.status(200).json({ message: 'Checklist item deleted', ...result });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Induction] deleteItem error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function seedStarterItems(req, res) {
  try {
    const items = await InductionChecklist.seedStarterItems();
    return res.status(201).json({
      message: 'Starter induction checklist added',
      items,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Induction] seedStarterItems error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyProgress(req, res) {
  try {
    const progress = await InductionChecklist.getVolunteerProgress(req.session.userId);
    return res.status(200).json(progress);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Induction] getMyProgress error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerInduction(req, res) {
  try {
    const progress = await InductionChecklist.getVolunteerProgress(Number(req.params.userId));
    return res.status(200).json(progress);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Induction] getVolunteerInduction error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function setVolunteerInductionItem(req, res) {
  try {
    const progress = await InductionChecklist.setItemDone(
      Number(req.params.userId),
      Number(req.params.itemId),
      {
        done: req.body?.done,
        completedBy: req.session?.userId,
      }
    );
    return res.status(200).json({
      message: 'Induction progress updated',
      ...progress,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Induction] setVolunteerInductionItem error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  seedStarterItems,
  getMyProgress,
  getVolunteerInduction,
  setVolunteerInductionItem,
};
