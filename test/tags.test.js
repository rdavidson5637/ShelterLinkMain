'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
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
    sendOpportunityMatchDigest: async (...args) => {
      emailCalls.push(['digest', ...args]);
    },
  },
};

const jobLogPath = require.resolve('../utils/jobLog');
const jobRuns = [];
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
  },
};

const Tag = require('../models/Tag');
const { runOpportunityMatchDigest } = require('../jobs/opportunityMatchDigest');

test('computeMatchScore weights tag overlap above availability', () => {
  assert.strictEqual(Tag.computeMatchScore(2, true), 2 * Tag.TAG_OVERLAP_WEIGHT + Tag.AVAILABILITY_MATCH_WEIGHT);
  assert.strictEqual(Tag.computeMatchScore(1, false), Tag.TAG_OVERLAP_WEIGHT);
  assert.strictEqual(Tag.computeMatchScore(0, true), Tag.AVAILABILITY_MATCH_WEIGHT);
});

test('compareRecommendationScore orders by score then start_date', () => {
  const items = [
    { opportunity_id: 1, score: 10, start_date: '2026-09-02T10:00:00' },
    { opportunity_id: 2, score: 25, start_date: '2026-09-10T10:00:00' },
    { opportunity_id: 3, score: 25, start_date: '2026-09-01T10:00:00' },
    { opportunity_id: 4, score: 5, start_date: '2026-08-20T10:00:00' },
  ];
  const ordered = [...items].sort(Tag.compareRecommendationScore);
  assert.deepStrictEqual(
    ordered.map((o) => o.opportunity_id),
    [3, 2, 1, 4]
  );
});

test('matchesAvailability: weekdays, weekends, evenings, flexible', () => {
  // Wednesday 10:00 local
  const weekdayMorning = new Date(2026, 7, 12, 10, 0, 0); // Aug 12 2026 = Wednesday
  // Saturday 11:00
  const weekendMorning = new Date(2026, 7, 15, 11, 0, 0);
  // Wednesday 18:30
  const weekdayEvening = new Date(2026, 7, 12, 18, 30, 0);

  assert.strictEqual(Tag.matchesAvailability('Weekdays', weekdayMorning), true);
  assert.strictEqual(Tag.matchesAvailability('Weekdays', weekendMorning), false);
  assert.strictEqual(Tag.matchesAvailability('Weekends', weekendMorning), true);
  assert.strictEqual(Tag.matchesAvailability('Weekends', weekdayMorning), false);
  assert.strictEqual(Tag.matchesAvailability('Evenings', weekdayEvening), true);
  assert.strictEqual(Tag.matchesAvailability('Evenings', weekdayMorning), false);
  assert.strictEqual(Tag.matchesAvailability('Flexible', weekendMorning), true);
  assert.strictEqual(Tag.matchesAvailability('Flexible', weekdayEvening), true);
  assert.strictEqual(Tag.matchesAvailability('', weekdayMorning), false);
});

test('shouldSendDigestToday de-duplicates same calendar day', () => {
  assert.strictEqual(Tag.shouldSendDigestToday([], '2026-08-11'), true);
  assert.strictEqual(Tag.shouldSendDigestToday(['2026-08-11'], '2026-08-11'), false);
  assert.strictEqual(Tag.shouldSendDigestToday(['2026-08-10'], '2026-08-11'), true);
});

test('digest job skips volunteers already logged today', async () => {
  emailCalls.length = 0;
  jobRuns.length = 0;
  mock.resetCalls();

  const now = new Date('2026-08-11T12:00:00Z');
  let digestMarked = false;

  mock.setHandler(async (sql, params) => {
    if (/FROM opportunity_match_queue/i.test(sql) && /LEFT JOIN tag_digest_log/i.test(sql)) {
      return [[
        {
          queue_id: 1,
          user_id: 10,
          opportunity_id: 100,
          email: 'fresh@example.com',
          first_name: 'Fresh',
          opportunity_title: 'Dog Walk',
          start_date: '2026-08-20 10:00:00',
          location: 'Kennels',
        },
        {
          queue_id: 2,
          user_id: 11,
          opportunity_id: 100,
          email: 'already@example.com',
          first_name: 'Already',
          opportunity_title: 'Dog Walk',
          start_date: '2026-08-20 10:00:00',
          location: 'Kennels',
        },
      ]];
    }
    if (/FROM tag_digest_log WHERE user_id/i.test(sql)) {
      const userId = params[0];
      // user 11 already received today's digest (defence-in-depth path)
      if (Number(userId) === 11) return [[{ ok: 1 }]];
      return [[]];
    }
    if (/INSERT IGNORE INTO tag_digest_log/i.test(sql)) {
      digestMarked = true;
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM opportunity_match_queue/i.test(sql)) {
      return [{ affectedRows: params.length }];
    }
    return [[]];
  });

  const result = await runOpportunityMatchDigest({ now });
  assert.strictEqual(result.sent, 1);
  assert.ok(result.skipped >= 1);
  assert.strictEqual(emailCalls.length, 1);
  assert.strictEqual(emailCalls[0][0], 'digest');
  assert.strictEqual(emailCalls[0][1], 'fresh@example.com');
  assert.ok(digestMarked);
});

test('digest job does not send twice for same user in one run', async () => {
  emailCalls.length = 0;
  jobRuns.length = 0;
  mock.resetCalls();

  const now = new Date('2026-08-11T15:00:00Z');
  const sentUsers = new Set();

  mock.setHandler(async (sql, params) => {
    if (/FROM opportunity_match_queue/i.test(sql) && /LEFT JOIN tag_digest_log/i.test(sql)) {
      // Two opportunities queued for the same volunteer — one digest email.
      return [[
        {
          queue_id: 1,
          user_id: 20,
          opportunity_id: 1,
          email: 'one@example.com',
          first_name: 'One',
          opportunity_title: 'Cats',
          start_date: '2026-08-21 09:00:00',
          location: 'Cattery',
        },
        {
          queue_id: 2,
          user_id: 20,
          opportunity_id: 2,
          email: 'one@example.com',
          first_name: 'One',
          opportunity_title: 'Dogs',
          start_date: '2026-08-22 09:00:00',
          location: 'Kennels',
        },
      ]];
    }
    if (/FROM tag_digest_log WHERE user_id/i.test(sql)) {
      return [sentUsers.has(Number(params[0])) ? [{ ok: 1 }] : []];
    }
    if (/INSERT IGNORE INTO tag_digest_log/i.test(sql)) {
      sentUsers.add(Number(params[0]));
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM opportunity_match_queue/i.test(sql)) {
      return [{ affectedRows: 2 }];
    }
    return [[]];
  });

  const result = await runOpportunityMatchDigest({ now });
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(emailCalls.length, 1);
  const opportunities = emailCalls[0][2].opportunities;
  assert.strictEqual(opportunities.length, 2);
});
