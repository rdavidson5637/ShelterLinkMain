'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendApplicationConfirmation: async () => {},
    sendApplicationApproval: async () => {},
    sendApplicationCancellation: async () => {},
    sendApplicationRejection: async () => {},
    sendWaitlistPromotion: async () => {},
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
    sendShiftReminder: async () => {},
    sendQualificationExpiryNotice: async () => {},
  },
};

const CustomField = require('../models/CustomField');
const profileCtrl = require('../controllers/profileController');
const exportCtrl = require('../controllers/exportController');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.send = (b) => {
    res.body = b;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 5, role: 'volunteer' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

const REQUIRED_SELECT_FIELD = {
  id: 10,
  label: 'T-shirt size',
  field_type: 'select',
  options: ['S', 'M', 'L'],
  options_json: '["S","M","L"]',
  required: true,
  applies_to: 'profile',
  sort_order: 0,
  active: true,
};

test('validateSubmittedValues blocks missing required custom field', () => {
  const result = CustomField.validateSubmittedValues([REQUIRED_SELECT_FIELD], {});
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join(' '), /T-shirt size.*required/i);
});

test('validateSubmittedValues rejects select value outside options', () => {
  const result = CustomField.validateSubmittedValues(
    [REQUIRED_SELECT_FIELD],
    { 10: 'XXL' }
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join(' '), /one of/i);
});

test('validateSubmittedValues accepts a valid select option', () => {
  const result = CustomField.validateSubmittedValues(
    [REQUIRED_SELECT_FIELD],
    { 10: 'M' }
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.values[10], 'M');
});

test('createProfile rejects when required custom field is missing', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM volunteer_profiles/i.test(sql) && /WHERE vp\.user_id/i.test(sql)) {
      return [[]];
    }
    if (/FROM custom_fields/i.test(sql) && /active = 1/i.test(sql)) {
      return [[
        {
          id: 10,
          label: 'Emergency notes',
          field_type: 'text',
          options_json: null,
          required: 1,
          applies_to: 'profile',
          sort_order: 0,
          active: 1,
        },
      ]];
    }
    return [[]];
  });

  const req = makeReq({
    body: {
      availability: 'Weekdays',
      date_of_birth: '1990-01-01',
      address: '1 Road',
      emergency_contact: 'Parent',
      skills: '',
      custom_fields: {},
    },
  });
  const res = makeRes();
  await profileCtrl.createProfile(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.match(String(res.body?.error || ''), /Emergency notes/i);
  assert.ok(
    !mock.calls.some((c) => /INSERT INTO volunteer_profiles/i.test(c.sql)),
    'must not create profile when custom field validation fails'
  );
});

test('createProfile rejects invalid select option', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM volunteer_profiles/i.test(sql) && /WHERE vp\.user_id/i.test(sql)) {
      return [[]];
    }
    if (/FROM custom_fields/i.test(sql) && /active = 1/i.test(sql)) {
      return [[
        {
          id: 10,
          label: 'T-shirt size',
          field_type: 'select',
          options_json: '["S","M","L"]',
          required: 1,
          applies_to: 'profile',
          sort_order: 0,
          active: 1,
        },
      ]];
    }
    return [[]];
  });

  const req = makeReq({
    body: {
      availability: 'Weekdays',
      custom_fields: { 10: 'XXL' },
    },
  });
  const res = makeRes();
  await profileCtrl.createProfile(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.match(String(res.body?.error || ''), /one of/i);
});

test('exportVolunteers includes custom field columns', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u/i.test(sql) && /role = 'volunteer'/i.test(sql)) {
      return [[
        {
          user_id: 5,
          first_name: 'Alex',
          last_name: 'Volunteer',
          email: 'alex@example.com',
          phone: '01234',
          approved: 1,
          total_hours: 3,
          created_at: '2026-01-01',
        },
      ]];
    }
    if (/FROM custom_fields/i.test(sql)) {
      return [[
        {
          id: 10,
          label: 'T-shirt size',
          field_type: 'select',
          options_json: '["S","M","L"]',
          required: 1,
          applies_to: 'profile',
          sort_order: 0,
          active: 1,
        },
        {
          id: 11,
          label: 'Has transport',
          field_type: 'checkbox',
          options_json: null,
          required: 0,
          applies_to: 'profile',
          sort_order: 1,
          active: 1,
        },
      ]];
    }
    if (/FROM custom_field_values/i.test(sql)) {
      return [[
        { field_id: 10, user_id: 5, value: 'M' },
        { field_id: 11, user_id: 5, value: '1' },
      ]];
    }
    return [[]];
  });

  const req = makeReq({
    session: { userId: 1, role: 'admin' },
  });
  const res = makeRes();
  await exportCtrl.exportVolunteers(req, res);

  assert.strictEqual(res.statusCode, 200);
  const csv = String(res.body || '');
  assert.match(csv, /T-shirt size/);
  assert.match(csv, /Has transport/);
  assert.match(csv, /"M"/);
  assert.match(csv, /"Yes"/);
});

test('removeOrDeactivate soft-deactivates when values exist', async () => {
  mock.resetCalls();
  let active = 1;
  mock.setHandler(async (sql, params) => {
    if (/FROM custom_fields WHERE id/i.test(sql)) {
      return [[
        {
          id: 10,
          label: 'Notes',
          field_type: 'text',
          options_json: null,
          required: 0,
          applies_to: 'profile',
          sort_order: 0,
          active,
        },
      ]];
    }
    if (/COUNT\(\*\) AS cnt FROM custom_field_values/i.test(sql)) {
      return [[{ cnt: 2 }]];
    }
    if (/UPDATE custom_fields SET/i.test(sql)) {
      active = 0;
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM custom_fields/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const result = await CustomField.removeOrDeactivate(10);
  assert.strictEqual(result.deleted, false);
  assert.strictEqual(result.deactivated, true);
  assert.ok(mock.calls.some((c) => /UPDATE custom_fields SET/i.test(c.sql)));
  assert.ok(!mock.calls.some((c) => /DELETE FROM custom_fields/i.test(c.sql)));
});
