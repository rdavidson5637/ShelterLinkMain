'use strict';

const Tag = require('../models/Tag');
const { notifyOnOpportunityCreate } = require('../jobs/opportunityMatchDigest');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function listTags(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const tags = await Tag.findAll();
    return res.status(200).json(tags);
  } catch (error) {
    console.error('[Tags] listTags error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getRecommended(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const limit = Math.min(Number(req.query?.limit) || 5, 20);
    const recommended = await Tag.findRecommendedForUser(userId, limit);
    return res.status(200).json(recommended);
  } catch (error) {
    console.error('[Tags] getRecommended error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listTags,
  getRecommended,
  notifyOnOpportunityCreate,
};
