const VolunteerProfile = require('../models/VolunteerProfile');
const VolunteerHours = require('../models/VolunteerHours');
const CustomField = require('../models/CustomField');
const Tag = require('../models/Tag');
const { calculateBadges } = require('../models/Badge');
const { pool } = require('../config/database');
const { sendVolunteerApprovalNotification } = require('../utils/emailService');
const { isStaffOrAdmin, isAdminUser } = require('../middleware/auth');

const REQUIRED_FIELDS = ['availability'];

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function validateRequiredFields(body = {}, fields = REQUIRED_FIELDS) {
  const missing = fields.filter((field) => !body[field]);
  if (missing.length) {
    return `Missing required fields: ${missing.join(', ')}`;
  }
  return null;
}

function extractCustomFieldPayload(body = {}) {
  if (body.custom_fields && typeof body.custom_fields === 'object' && !Array.isArray(body.custom_fields)) {
    return body.custom_fields;
  }
  if (body.custom_field_values && typeof body.custom_field_values === 'object') {
    return body.custom_field_values;
  }
  return {};
}

function extractTagIds(body = {}) {
  return Tag.normalizeTagIds(body.tag_ids ?? body.tagIds ?? body.tags);
}

async function attachCustomFields(profile, userId) {
  if (!profile) return profile;
  const definitions = await CustomField.findActiveForProfile();
  const values = await CustomField.findValuesByUserId(userId);
  const valueByFieldId = {};
  for (const row of values) {
    valueByFieldId[row.field_id] = row.value;
  }

  const tags = await Tag.findByUserId(userId);

  return {
    ...profile,
    tags,
    tag_ids: tags.map((t) => t.id),
    custom_fields: definitions.map((field) => ({
      ...field,
      value: valueByFieldId[field.id] != null ? valueByFieldId[field.id] : '',
    })),
    custom_field_values: values,
  };
}

async function validateAndStoreCustomFields(userId, body, { requireActive = true } = {}) {
  const fields = await CustomField.findActiveForProfile();
  if (!fields.length) {
    return { ok: true, values: {} };
  }

  const submitted = extractCustomFieldPayload(body);
  // On create/update of profile, always validate active required fields.
  const result = CustomField.validateSubmittedValues(fields, submitted);
  if (!result.ok) {
    return { ok: false, error: result.errors.join('; ') };
  }

  if (requireActive || Object.keys(submitted).length) {
    await CustomField.upsertValues(userId, result.values);
  }

  return { ok: true, values: result.values };
}

async function createProfile(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const validationError = validateRequiredFields(req.body || {});
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const existing = await VolunteerProfile.findByUserId(userId);
    if (existing) {
      return res.status(409).json({ error: 'Profile already exists' });
    }

    const fields = await CustomField.findActiveForProfile();
    const submitted = extractCustomFieldPayload(req.body || {});
    const customCheck = CustomField.validateSubmittedValues(fields, submitted);
    if (!customCheck.ok) {
      return res.status(400).json({ error: customCheck.errors.join('; ') });
    }

    const profile = await VolunteerProfile.create(userId, req.body || {});
    if (Object.keys(customCheck.values).length) {
      await CustomField.upsertValues(userId, customCheck.values);
    }
    const tagIds = extractTagIds(req.body || {});
    if (tagIds != null) {
      await Tag.setVolunteerTags(userId, tagIds);
    }
    const withCustom = await attachCustomFields(profile, userId);
    return res.status(201).json({
      message: 'Profile created successfully',
      profile: withCustom,
    });
  } catch (error) {
    console.error('[Profile] createProfile error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getProfile(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    const profile = await VolunteerProfile.findByUserId(userId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const withCustom = await attachCustomFields(profile, userId);
    return res.status(200).json(withCustom);
  } catch (error) {
    console.error('[Profile] getProfile error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateProfile(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const body = req.body || {};

    const hasCustom =
      (body.custom_fields && Object.keys(body.custom_fields).length) ||
      (body.custom_field_values && Object.keys(body.custom_field_values).length);
    const tagIds = extractTagIds(body);
    const hasTags = tagIds != null;
    const builtInKeys = Object.keys(body).filter(
      (k) =>
        k !== 'custom_fields' &&
        k !== 'custom_field_values' &&
        k !== 'tag_ids' &&
        k !== 'tagIds' &&
        k !== 'tags'
    );
    if (!builtInKeys.length && !hasCustom && !hasTags) {
      return res.status(400).json({ error: 'No profile fields provided' });
    }

    if (hasCustom || builtInKeys.length) {
      const customCheck = await validateAndStoreCustomFields(userId, body);
      if (!customCheck.ok) {
        return res.status(400).json({ error: customCheck.error });
      }
    }

    let profile = null;
    if (builtInKeys.length) {
      profile = await VolunteerProfile.update(userId, body);
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }
    } else {
      profile = await VolunteerProfile.findByUserId(userId);
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }
    }

    if (hasTags) {
      await Tag.setVolunteerTags(userId, tagIds);
    }

    const withCustom = await attachCustomFields(profile, userId);
    return res.status(200).json(withCustom);
  } catch (error) {
    console.error('[Profile] updateProfile error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAllVolunteers(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sql = `
      SELECT 
        u.user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        COALESCE(vp.approved, 0) AS approved,
        vp.skills,
        vp.availability,
        vp.volunteer_type,
        vp.required_hours,
        COALESCE(SUM(CASE WHEN vh.approved = 1 THEN vh.hours ELSE 0 END), 0) AS total_hours,
        (
          SELECT COUNT(*)
          FROM applications a
          WHERE a.user_id = u.user_id
            AND a.no_show = 1
        ) AS no_show_count
      FROM users u
      LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      LEFT JOIN volunteer_hours vh ON vh.user_id = u.user_id
      WHERE u.role = 'volunteer'
      GROUP BY u.user_id, u.first_name, u.last_name, u.email, u.phone, vp.approved, vp.skills, vp.availability, vp.volunteer_type, vp.required_hours
      ORDER BY u.first_name, u.last_name
    `;

    const [rows] = await pool.execute(sql);
    const withId = rows.map((row) => ({ ...row, id: row.user_id }));
    return res.status(200).json(withId);
  } catch (error) {
    console.error('[Profile] getAllVolunteers error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateVolunteerApproval(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    // Profile approval is admin-only (staff cannot approve).
    if (!isAdminUser(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { userId } = req.params;
    const { approved } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({
        error: 'approved must be a boolean value',
      });
    }

    const result = await VolunteerProfile.updateApprovalStatus(userId, approved);

    if (!result) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Send email notification when volunteer is approved
    if (approved) {
      try {
        const [rows] = await pool.execute(
          'SELECT email, first_name FROM users WHERE user_id = ? LIMIT 1',
          [userId]
        );
        const user = rows[0];
        if (user?.email) {
          await sendVolunteerApprovalNotification(user.email, user.first_name);
        }
      } catch (emailError) {
        console.error('[Profile] updateVolunteerApproval email error:', emailError.message);
      }
    }

    return res.status(200).json({
      message: `Profile ${approved ? 'approved' : 'unapproved'} successfully`,
      approved,
    });
  } catch (error) {
    console.error('[Profile] updateVolunteerApproval error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerProfile(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { userId } = req.params;
    const profile = await VolunteerProfile.findByUserId(userId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const withCustom = await attachCustomFields(profile, userId);
    // Admins also see values for inactive fields the volunteer previously answered
    const allValues = await CustomField.findValuesByUserId(userId);
    withCustom.custom_field_values = allValues;
    return res.status(200).json(withCustom);
  } catch (error) {
    console.error('[Profile] getVolunteerProfile error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getBadges(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const badges = await calculateBadges(userId);
    return res.status(200).json(badges);
  } catch (error) {
    console.error('[Profile] getBadges error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateVolunteerServiceSettings(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { userId } = req.params;
    const volunteerType = req.body?.volunteer_type;
    const requiredHours =
      typeof req.body?.required_hours !== 'undefined'
        ? req.body.required_hours
        : undefined;

    try {
      const result = await VolunteerProfile.updateServiceSettings(userId, {
        volunteerType,
        requiredHours,
      });
      if (!result) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      return res.status(200).json(result);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
  } catch (error) {
    console.error('[Profile] updateVolunteerServiceSettings error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createProfile,
  getProfile,
  updateProfile,
  getAllVolunteers,
  updateVolunteerApproval,
  getVolunteerProfile,
  getBadges,
  updateVolunteerServiceSettings,
};
