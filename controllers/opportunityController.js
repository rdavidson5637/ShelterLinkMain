const Opportunity = require('../models/Opportunity');
const Qualification = require('../models/Qualification');
const Tag = require('../models/Tag');
const { notifyOnOpportunityCreate } = require('../jobs/opportunityMatchDigest');
const { isStaffOrAdmin } = require('../middleware/auth');

const REQUIRED_FIELDS = ['title', 'description', 'location', 'start_date', 'end_date'];
const VALID_RECURRENCE_RULES = new Set(['none', 'daily', 'weekly']);

function normalizeQualificationIds(body = {}) {
  const raw = body.qualification_ids ?? body.qualificationIds ?? body.required_qualifications;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw
      .map((id) => (typeof id === 'object' && id != null ? Number(id.id ?? id.qualification_id) : Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);
  }
  return [];
}

function normalizeTagIds(body = {}) {
  const raw = body.tag_ids ?? body.tagIds ?? body.tags;
  return Tag.normalizeTagIds(raw);
}

async function applyQualificationIds(opportunityIds, qualificationIds) {
  if (qualificationIds == null) return;
  const ids = Array.isArray(opportunityIds) ? opportunityIds : [opportunityIds];
  for (const opportunityId of ids) {
    if (!opportunityId) continue;
    await Qualification.setRequiredForOpportunity(opportunityId, qualificationIds);
  }
}

async function applyTagIds(opportunityIds, tagIds) {
  if (tagIds == null) return;
  const ids = Array.isArray(opportunityIds) ? opportunityIds : [opportunityIds];
  for (const opportunityId of ids) {
    if (!opportunityId) continue;
    await Tag.setOpportunityTags(opportunityId, tagIds);
  }
}

async function withExtras(opportunityOrList) {
  if (!opportunityOrList) return opportunityOrList;
  const list = Array.isArray(opportunityOrList) ? opportunityOrList : [opportunityOrList];
  const withQuals = await Qualification.attachRequiredQualifications(list);
  const withTags = await Tag.attachTags(withQuals);
  return Array.isArray(opportunityOrList) ? withTags : withTags[0];
}

async function withRequiredQualifications(opportunityOrList) {
  return withExtras(opportunityOrList);
}

function validateRequiredFields(body = {}) {
  const missing = REQUIRED_FIELDS.filter((field) => !body[field]);
  if (missing.length) {
    return `Missing required fields: ${missing.join(', ')}`;
  }
  return null;
}

function isAdmin(req) {
  // Staff and admin share opportunity management privileges.
  return isStaffOrAdmin(req);
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

async function createOpportunity(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const validationError = validateRequiredFields(req.body || {});
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { start_date, end_date } = req.body;
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({
        error: 'End date must be on or after start date',
      });
    }

    const recurrence_rule = VALID_RECURRENCE_RULES.has(req.body.recurrence_rule)
      ? req.body.recurrence_rule
      : 'none';
    const recurrence_until = req.body.recurrence_until || null;

    if (recurrence_rule !== 'none') {
      if (!recurrence_until) {
        return res.status(400).json({
          error: 'recurrence_until is required when repeating',
        });
      }
      if (toDateOnly(recurrence_until) <= toDateOnly(start_date)) {
        return res.status(400).json({
          error: 'recurrence_until must be after the start date',
        });
      }
    }

    const created_by = req.session.userId;
    const qualificationIds = normalizeQualificationIds(req.body);
    const tagIds = normalizeTagIds(req.body);

    // Non-recurring path stays identical to the original single-create behaviour.
    if (recurrence_rule === 'none') {
      const opportunityData = {
        ...req.body,
        status: 'open',
        created_by,
        recurrence_rule: 'none',
        recurrence_until: null,
        parent_opportunity_id: null,
      };
      const opportunity = await Opportunity.create(opportunityData);
      await applyQualificationIds(opportunity.opportunity_id, qualificationIds);
      await applyTagIds(opportunity.opportunity_id, tagIds);
      try {
        await notifyOnOpportunityCreate([opportunity.opportunity_id]);
      } catch (notifyError) {
        console.error('[Opportunity] match notify error:', notifyError.message);
      }
      return res.status(201).json(await withExtras(opportunity));
    }

    const { parent, children, total } = await Opportunity.createWithRecurrence({
      ...req.body,
      status: 'open',
      created_by,
      recurrence_rule,
      recurrence_until,
    });

    const allIds = [parent.opportunity_id, ...children.map((c) => c.opportunity_id)];
    await applyQualificationIds(allIds, qualificationIds);
    await applyTagIds(allIds, tagIds);
    try {
      await notifyOnOpportunityCreate(allIds);
    } catch (notifyError) {
      console.error('[Opportunity] match notify error:', notifyError.message);
    }
    const enrichedParent = await withExtras(parent);

    return res.status(201).json({
      ...enrichedParent,
      series_count: total,
    });
  } catch (error) {
    console.error('[Opportunity] createOpportunity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function stripAdminFields(opportunity, isAdminUser) {
  if (!opportunity || isAdminUser) return opportunity;
  const copy = { ...opportunity };
  delete copy.check_in_code;
  delete copy.activity_notes;
  return copy;
}

async function getAllOpportunities(req, res) {
  try {
    const requestedStatus = req.query?.status;
    const filters = {};

    if (requestedStatus) {
      filters.status = requestedStatus;
    } else if (!isStaffOrAdmin(req)) {
      filters.status = 'open';
    }

    let opportunities = await Opportunity.findAll(filters);
    const admin = isStaffOrAdmin(req);
    let enriched = await withExtras(opportunities);

    const tagFilter = req.query?.tag || req.query?.tag_id || req.query?.tagId;
    if (tagFilter) {
      const tagKey = String(tagFilter).toLowerCase();
      enriched = enriched.filter((opp) =>
        (opp.tags || []).some(
          (t) =>
            String(t.id) === String(tagFilter) ||
            String(t.name || '').toLowerCase() === tagKey
        )
      );
    }

    return res.status(200).json(enriched.map((o) => stripAdminFields(o, admin)));
  } catch (error) {
    console.error('[Opportunity] getAllOpportunities error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getOpportunity(req, res) {
  try {
    const { id } = req.params;
    const opportunity = await Opportunity.findById(id);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    if (!isStaffOrAdmin(req) && opportunity.status !== 'open') {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    const enriched = await withExtras(opportunity);
    return res.status(200).json(stripAdminFields(enriched, isStaffOrAdmin(req)));
  } catch (error) {
    console.error('[Opportunity] getOpportunity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateOpportunity(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    if (!Object.keys(req.body || {}).length) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    const existing = await Opportunity.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const previousMax = Number(existing.max_volunteers);
    const opportunity = await Opportunity.update(id, req.body);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const qualificationIds = normalizeQualificationIds(req.body);
    if (qualificationIds != null) {
      await applyQualificationIds(opportunity.opportunity_id, qualificationIds);
    }

    const tagIds = normalizeTagIds(req.body);
    if (tagIds != null) {
      await applyTagIds(opportunity.opportunity_id, tagIds);
    }

    const newMax = Number(opportunity.max_volunteers);
    const maxIncreased =
      Number.isFinite(newMax) &&
      newMax > 0 &&
      (!Number.isFinite(previousMax) || previousMax <= 0 || newMax > previousMax);

    if (maxIncreased) {
      const { promoteOldestWaitlisted } = require('./applicationController');
      const capacity = await Opportunity.getCurrentCapacity(id);
      if (capacity < newMax) {
        if (opportunity.status === 'closed') {
          await Opportunity.updateStatus(id, 'open');
        }
        await promoteOldestWaitlisted(id);
      }
    }

    return res.status(200).json(await withExtras(opportunity));
  } catch (error) {
    console.error('[Opportunity] updateOpportunity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteOpportunity(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const series = String(req.query?.series || '').toLowerCase() === 'true';

    if (series) {
      const existing = await Opportunity.findById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }

      const result = await Opportunity.deleteSeries(id);
      return res.status(200).json({
        message: 'Series delete completed',
        deleted: result.deleted,
        skipped: result.skipped,
        skippedIds: result.skippedIds,
      });
    }

    const opportunity = await Opportunity.updateStatus(id, 'closed');
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    return res.status(200).json({ message: 'Opportunity closed' });
  } catch (error) {
    console.error('[Opportunity] deleteOpportunity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createOpportunity,
  getAllOpportunities,
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
};
