const Opportunity = require('../models/Opportunity');
const { excludeTestOpportunities, isTestOrE2EOpportunity } = require('../utils/testOpportunityGuard');
const Application = require('../models/Application');
const Qualification = require('../models/Qualification');
const Tag = require('../models/Tag');
const Animal = require('../models/Animal');
const AdminMessage = require('../models/AdminMessage');
const { notifyOnOpportunityCreate } = require('../jobs/opportunityMatchDigest');
const { isStaffOrAdmin } = require('../middleware/auth');
const { sendUrgentCover } = require('../utils/emailService');
const pushService = require('../utils/pushService');
const Vetting = require('../models/Vetting');

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

function normalizeAnimalIds(body = {}) {
  const raw = body.animal_ids ?? body.animalIds ?? body.animals;
  return Animal.normalizeAnimalIds(raw);
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

async function applyAnimalIds(opportunityIds, animalIds) {
  if (animalIds == null) return;
  const ids = Array.isArray(opportunityIds) ? opportunityIds : [opportunityIds];
  for (const opportunityId of ids) {
    if (!opportunityId) continue;
    await Animal.setOpportunityAnimals(opportunityId, animalIds);
  }
}

async function withExtras(opportunityOrList) {
  if (!opportunityOrList) return opportunityOrList;
  const list = Array.isArray(opportunityOrList) ? opportunityOrList : [opportunityOrList];
  const withQuals = await Qualification.attachRequiredQualifications(list);
  const withTags = await Tag.attachTags(withQuals);
  const withAnimals = await Animal.attachAnimals(withTags);
  const ShiftNote = require('../models/ShiftNote');
  const notesByOpp = await ShiftNote.findByOpportunityIds(
    withAnimals.map((o) => o.opportunity_id || o.id)
  );
  const withNotes = withAnimals.map((o) => ({
    ...o,
    shift_notes: notesByOpp.get(Number(o.opportunity_id || o.id)) || [],
  }));
  return Array.isArray(opportunityOrList) ? withNotes : withNotes[0];
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
    const animalIds = normalizeAnimalIds(req.body);
    const bgType = Vetting.normalizeCheckType(
      req.body.required_background_check_type ?? req.body.requiredBackgroundCheckType
    );

    // Non-recurring path stays identical to the original single-create behaviour.
    if (recurrence_rule === 'none') {
      const opportunityData = {
        ...req.body,
        required_background_check_type: bgType,
        status: 'open',
        created_by,
        recurrence_rule: 'none',
        recurrence_until: null,
        parent_opportunity_id: null,
      };
      const opportunity = await Opportunity.create(opportunityData);
      await applyQualificationIds(opportunity.opportunity_id, qualificationIds);
      await applyTagIds(opportunity.opportunity_id, tagIds);
      await applyAnimalIds(opportunity.opportunity_id, animalIds);
      try {
        await notifyOnOpportunityCreate([opportunity.opportunity_id]);
      } catch (notifyError) {
        console.error('[Opportunity] match notify error:', notifyError.message);
      }
      return res.status(201).json(await withExtras(opportunity));
    }

    const { parent, children, total } = await Opportunity.createWithRecurrence({
      ...req.body,
      required_background_check_type: bgType,
      status: 'open',
      created_by,
      recurrence_rule,
      recurrence_until,
    });

    const allIds = [parent.opportunity_id, ...children.map((c) => c.opportunity_id)];
    await applyQualificationIds(allIds, qualificationIds);
    await applyTagIds(allIds, tagIds);
    await applyAnimalIds(allIds, animalIds);
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
  // Volunteers browsing open shifts see animals without internal notes;
  // handling_notes stay visible — they are safety-critical for the shift.
  if (Array.isArray(copy.animals)) {
    copy.animals = copy.animals.map((a) => ({
      id: a.id,
      name: a.name,
      species: a.species,
      breed: a.breed,
      status: a.status,
      photo_filename: a.photo_filename,
      handling_notes: a.handling_notes,
      requires_qualification_id: a.requires_qualification_id,
      requires_qualification_name: a.requires_qualification_name,
    }));
  }
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
    if (!admin) {
      opportunities = excludeTestOpportunities(opportunities);
    }
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
    if (!isStaffOrAdmin(req) && process.env.NODE_ENV === 'production' && isTestOrE2EOpportunity(opportunity)) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    if (!isStaffOrAdmin(req) && opportunity.status !== 'open') {
      // A shift stops being 'open' the moment it's full, past, or cancelled —
      // which is exactly when a volunteer with a real (often accepted, often
      // completed) application to it needs to still be able to see it, e.g.
      // from My Applications. Gate on having applied, not on current status.
      const applied = req.session?.userId
        ? await Application.checkExisting(req.session.userId, id)
        : null;
      if (!applied) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }
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
    const updateBody = { ...(req.body || {}) };
    if (
      Object.prototype.hasOwnProperty.call(updateBody, 'required_background_check_type') ||
      Object.prototype.hasOwnProperty.call(updateBody, 'requiredBackgroundCheckType')
    ) {
      const raw =
        updateBody.required_background_check_type ?? updateBody.requiredBackgroundCheckType;
      updateBody.required_background_check_type =
        raw == null || raw === '' ? null : Vetting.normalizeCheckType(raw);
      delete updateBody.requiredBackgroundCheckType;
    }
    const opportunity = await Opportunity.update(id, updateBody);
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

    const animalIds = normalizeAnimalIds(req.body);
    if (animalIds != null) {
      await applyAnimalIds(opportunity.opportunity_id, animalIds);
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

async function cloneOpportunity(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const source = await Opportunity.findById(id);
    if (!source) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const enrichedSource = await withExtras(source);
    const clone = await Opportunity.cloneFrom(id, req.session.userId);
    if (!clone) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const qualificationIds = (enrichedSource.required_qualifications || [])
      .map((q) => Number(q.id || q.qualification_id))
      .filter((n) => Number.isFinite(n) && n > 0);
    const tagIds = (enrichedSource.tags || []).map((t) => Number(t.id)).filter(Boolean);
    const animalIds = (enrichedSource.animals || []).map((a) => Number(a.id)).filter(Boolean);

    await applyQualificationIds(clone.opportunity_id, qualificationIds);
    await applyTagIds(clone.opportunity_id, tagIds);
    await applyAnimalIds(clone.opportunity_id, animalIds);

    return res.status(201).json(await withExtras(clone));
  } catch (error) {
    console.error('[Opportunity] cloneOpportunity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function flagOpportunityUrgent(req, res) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const opportunity = await Opportunity.findById(id);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    if (opportunity.status !== 'open') {
      return res.status(400).json({ error: 'Only open opportunities can be flagged urgent' });
    }
    if (!Opportunity.isUpcoming(opportunity)) {
      return res.status(400).json({ error: 'Only upcoming opportunities can be flagged urgent' });
    }
    if (!Opportunity.isUnderstaffed(opportunity)) {
      return res.status(400).json({ error: 'Opportunity is already fully staffed' });
    }
    if (!Opportunity.canReflagUrgent(opportunity)) {
      return res.status(429).json({
        error: 'Urgent cover was already broadcast in the last 24 hours',
      });
    }

    const recipients = await Opportunity.resolveUrgentCoverRecipients(id, { limit: 200 });
    const whenLabel = String(opportunity.start_date || '').slice(0, 10);
    const subject = `Cover needed: ${opportunity.title || 'shift'}${whenLabel ? ` ${whenLabel}` : ''}`;

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await sendUrgentCover(recipient.email, {
          firstName: recipient.first_name,
          opportunityTitle: opportunity.title,
          whenLabel,
          location: opportunity.location,
        });
        sent += 1;
      } catch (emailError) {
        failed += 1;
        console.error('[Opportunity] urgent email failed:', emailError.message);
      }
    }

    let pushResult = { sent: 0, skipped: 0, failed: 0, configured: false };
    try {
      pushResult = await pushService.sendToUsers(
        recipients.map((r) => r.user_id),
        {
          title: subject,
          body: `Urgent cover needed for ${opportunity.title || 'a shift'}${
            whenLabel ? ` on ${whenLabel}` : ''
          }.`,
          url: '/pages/volunteer/browse-shifts.html',
          type: 'urgent_cover',
          opportunityId: Number(id),
        },
        { category: 'urgent' }
      );
    } catch (pushError) {
      console.error('[Opportunity] urgent push failed:', pushError.message);
    }

    const flagged = await Opportunity.flagUrgent(id);
    await AdminMessage.createMessageLog({
      adminId: req.session.userId,
      subject,
      body: `Urgent cover broadcast for opportunity ${id}`,
      filter: { type: 'urgent_cover', opportunityId: Number(id) },
      recipientCount: sent,
    });

    return res.status(200).json({
      opportunity: await withExtras(flagged),
      recipients: recipients.length,
      sent,
      failed,
      push: pushResult,
    });
  } catch (error) {
    console.error('[Opportunity] flagOpportunityUrgent error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createOpportunity,
  getAllOpportunities,
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
  cloneOpportunity,
  flagOpportunityUrgent,
};
