'use strict';

const CustomField = require('../models/CustomField');
const { isAdminUser, isStaffOrAdmin } = require('../middleware/auth');

function ensureAdmin(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isAdminUser(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function parseOptionsFromBody(body = {}) {
  if (Array.isArray(body.options)) {
    return body.options.map((o) => String(o).trim()).filter(Boolean);
  }
  if (typeof body.options === 'string' && body.options.trim()) {
    return body.options
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  if (body.options_json) {
    return CustomField.parseOptions(body.options_json);
  }
  return [];
}

async function listCustomFields(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const activeOnly = req.query?.active === '1' || req.query?.active === 'true';
    const staffView = isStaffOrAdmin(req);
    const fields = await CustomField.findAll({
      activeOnly: activeOnly || !staffView,
    });
    return res.status(200).json(fields);
  } catch (error) {
    console.error('[CustomField] listCustomFields error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listActiveProfileFields(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const fields = await CustomField.findActiveForProfile();
    return res.status(200).json(fields);
  } catch (error) {
    console.error('[CustomField] listActiveProfileFields error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createCustomField(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const label = String(req.body?.label || '').trim();
    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const field_type = String(req.body?.field_type || 'text').toLowerCase();
    if (!CustomField.FIELD_TYPES.has(field_type)) {
      return res.status(400).json({
        error: `field_type must be one of: ${[...CustomField.FIELD_TYPES].join(', ')}`,
      });
    }

    const options = parseOptionsFromBody(req.body);
    if (field_type === 'select' && options.length < 1) {
      return res.status(400).json({ error: 'select fields require at least one option' });
    }

    const created = await CustomField.create({
      label,
      field_type,
      options,
      required: Boolean(req.body?.required),
      applies_to: req.body?.applies_to || 'profile',
      sort_order: req.body?.sort_order,
      active: req.body?.active !== false && req.body?.active !== 0,
    });

    return res.status(201).json(created);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[CustomField] createCustomField error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateCustomField(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;
    const data = {};

    if (typeof req.body?.label !== 'undefined') {
      data.label = String(req.body.label).trim();
      if (!data.label) {
        return res.status(400).json({ error: 'label cannot be empty' });
      }
    }
    if (typeof req.body?.field_type !== 'undefined') {
      data.field_type = String(req.body.field_type).toLowerCase();
      if (!CustomField.FIELD_TYPES.has(data.field_type)) {
        return res.status(400).json({
          error: `field_type must be one of: ${[...CustomField.FIELD_TYPES].join(', ')}`,
        });
      }
    }
    if (
      typeof req.body?.options !== 'undefined' ||
      typeof req.body?.options_json !== 'undefined'
    ) {
      data.options = parseOptionsFromBody(req.body);
    }
    if (typeof req.body?.required !== 'undefined') {
      data.required = Boolean(req.body.required);
    }
    if (typeof req.body?.applies_to !== 'undefined') {
      data.applies_to = req.body.applies_to || 'profile';
    }
    if (typeof req.body?.sort_order !== 'undefined') {
      data.sort_order = Number(req.body.sort_order);
    }
    if (typeof req.body?.active !== 'undefined') {
      data.active = Boolean(req.body.active);
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    const existing = await CustomField.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Custom field not found' });
    }

    const nextType = data.field_type || existing.field_type;
    if (nextType === 'select') {
      const opts =
        typeof data.options !== 'undefined' ? data.options : existing.options;
      if (!opts.length) {
        return res.status(400).json({ error: 'select fields require at least one option' });
      }
    }

    const updated = await CustomField.update(id, data);
    return res.status(200).json(updated);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[CustomField] updateCustomField error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deactivateCustomField(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const updated = await CustomField.deactivate(req.params.id);
    if (!updated) {
      return res.status(404).json({ error: 'Custom field not found' });
    }
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[CustomField] deactivateCustomField error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteCustomField(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const result = await CustomField.removeOrDeactivate(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Custom field not found' });
    }
    if (result.deactivated) {
      return res.status(200).json({
        message: 'Field has existing values and was deactivated instead of deleted',
        deactivated: true,
        field: result.field,
      });
    }
    return res.status(200).json({ message: 'Custom field deleted', deleted: true });
  } catch (error) {
    console.error('[CustomField] deleteCustomField error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function reorderCustomFields(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const orderedIds = req.body?.ordered_ids || req.body?.ids || [];
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
      return res.status(400).json({ error: 'ordered_ids array is required' });
    }
    const fields = await CustomField.reorder(orderedIds);
    return res.status(200).json(fields);
  } catch (error) {
    console.error('[CustomField] reorderCustomFields error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerCustomValues(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const values = await CustomField.findValuesByUserId(req.params.userId);
    return res.status(200).json(values);
  } catch (error) {
    console.error('[CustomField] getVolunteerCustomValues error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listCustomFields,
  listActiveProfileFields,
  createCustomField,
  updateCustomField,
  deactivateCustomField,
  deleteCustomField,
  reorderCustomFields,
  getVolunteerCustomValues,
};
