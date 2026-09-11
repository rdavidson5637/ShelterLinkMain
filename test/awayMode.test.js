'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../models/VolunteerProfile')];
delete require.cache[require.resolve('../models/Application')];
delete require.cache[require.resolve('../models/Opportunity')];
delete require.cache[require.resolve('../models/Transport')];

const VolunteerProfile = require('../models/VolunteerProfile');
const Application = require('../models/Application');
const Opportunity = require('../models/Opportunity');
const Transport = require('../models/Transport');

test('isAway is true when away_until is today or later', () => {
  assert.strictEqual(
    VolunteerProfile.isAway({ away_until: '2026-08-26' }, new Date('2026-08-26T12:00:00Z')),
    true
  );
  assert.strictEqual(
    VolunteerProfile.isAway({ away_until: '2026-08-30' }, '2026-08-26'),
    true
  );
  assert.strictEqual(
    VolunteerProfile.isAway({ away_until: '2026-08-25' }, '2026-08-26'),
    false
  );
  assert.strictEqual(VolunteerProfile.isAway({ away_until: null }, '2026-08-26'), false);
  assert.strictEqual(VolunteerProfile.isAway(null, '2026-08-26'), false);
});

test('reminder query skips volunteers currently away', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    assert.match(sql, /away_until/i);
    assert.match(sql, /CURRENT_DATE/i);
    return [[]];
  });
  await Application.findAcceptedNeedingReminder(new Date('2026-08-26T12:00:00Z'));
});

test('urgent cover recipients skip away volunteers', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    assert.match(sql, /away_until/i);
    return [[]];
  });
  await Opportunity.resolveUrgentCoverRecipients(7);
});

test('transport chase-cover recipients skip away volunteers', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    assert.match(sql, /away_until/i);
    assert.match(sql, /CURRENT_DATE/i);
    return [[]];
  });
  await Transport.resolveChaseRecipients(3);
});

test('profile update allowlists away_until', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/UPDATE volunteer_profiles/i.test(sql)) {
      assert.match(sql, /away_until = \?/i);
      assert.strictEqual(params[0], '2026-09-01');
      return [{ affectedRows: 1 }];
    }
    return [[{ user_id: 3, away_until: '2026-09-01' }]];
  });
  const updated = await VolunteerProfile.update(3, { away_until: '2026-09-01', hack: 'nope' });
  assert.strictEqual(updated.away_until, '2026-09-01');
});
