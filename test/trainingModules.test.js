'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const TrainingModule = require('../models/TrainingModule');
const appCtrl = require('../controllers/applicationController');
const trainingCtrl = require('../controllers/trainingController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

test('scoreAttempt calculates percent and pass against the mark', () => {
  const questions = [
    { id: 1, correct_index: 0 },
    { id: 2, correct_index: 1 },
    { id: 3, correct_index: 2 },
    { id: 4, correct_index: 0 },
  ];
  const pass = TrainingModule.scoreAttempt(
    questions,
    [
      { question_id: 1, selected_index: 0 },
      { question_id: 2, selected_index: 1 },
      { question_id: 3, selected_index: 2 },
      { question_id: 4, selected_index: 1 },
    ],
    75
  );
  assert.strictEqual(pass.correct, 3);
  assert.strictEqual(pass.total, 4);
  assert.strictEqual(pass.score_percent, 75);
  assert.strictEqual(pass.passed, true);

  const fail = TrainingModule.scoreAttempt(
    questions,
    [
      { question_id: 1, selected_index: 0 },
      { question_id: 2, selected_index: 0 },
      { question_id: 3, selected_index: 0 },
      { question_id: 4, selected_index: 0 },
    ],
    80
  );
  assert.strictEqual(fail.score_percent, 50);
  assert.strictEqual(fail.passed, false);
});

test('scoreAttempt rejects empty question lists', () => {
  assert.throws(
    () => TrainingModule.scoreAttempt([], [], 80),
    (err) => err.status === 400
  );
});

test('getModule hides correct_index from volunteers', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM training_modules m/i.test(sql) && /WHERE m\.id/i.test(sql)) {
      return [[
        {
          id: 10,
          name: 'Dog walking level 1',
          description: 'Basics',
          content: 'Read this',
          pass_mark_percent: 80,
          awards_qualification_id: 3,
          awards_qualification_name: 'Dog walking level 1',
          active: 1,
          created_at: '2026-11-23',
          updated_at: '2026-11-23',
          question_count: 1,
        },
      ]];
    }
    if (/FROM training_questions/i.test(sql)) {
      return [[
        {
          id: 100,
          module_id: 10,
          prompt: 'Lead goes in which hand?',
          choices: JSON.stringify(['Left', 'Right', 'Neither']),
          correct_index: 0,
          sort_order: 0,
        },
      ]];
    }
    if (/FROM training_attempts/i.test(sql)) return [[]];
    return [[]];
  });

  const res = makeRes();
  await trainingCtrl.getModule(
    { session: { userId: 2, role: 'volunteer' }, params: { id: 10 }, query: {} },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.questions.length, 1);
  assert.strictEqual(res.body.questions[0].prompt, 'Lead goes in which hand?');
  assert.deepStrictEqual(res.body.questions[0].choices, ['Left', 'Right', 'Neither']);
  assert.strictEqual(res.body.questions[0].correct_index, undefined);
});

test('getModule includes correct_index for admin', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM training_modules m/i.test(sql) && /WHERE m\.id/i.test(sql)) {
      return [[
        {
          id: 10,
          name: 'Dog walking level 1',
          description: null,
          content: '',
          pass_mark_percent: 80,
          awards_qualification_id: null,
          awards_qualification_name: null,
          active: 1,
          created_at: '2026-11-23',
          updated_at: '2026-11-23',
          question_count: 1,
        },
      ]];
    }
    if (/FROM training_questions/i.test(sql)) {
      return [[
        {
          id: 100,
          module_id: 10,
          prompt: 'Q',
          choices: ['A', 'B'],
          correct_index: 1,
          sort_order: 0,
        },
      ]];
    }
    if (/FROM training_attempts/i.test(sql)) return [[]];
    return [[]];
  });

  const res = makeRes();
  await trainingCtrl.getModule(
    { session: { userId: 1, role: 'admin' }, params: { id: 10 }, query: {} },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.questions[0].correct_index, 1);
});

test('recordAttempt awards linked qualification when pass mark is met', async () => {
  mock.resetCalls();
  let awarded = false;
  mock.setHandler(async (sql, params) => {
    if (/FROM training_modules m/i.test(sql) && /WHERE m\.id/i.test(sql)) {
      return [[
        {
          id: 10,
          name: 'Dog walking level 1',
          description: null,
          content: 'content',
          pass_mark_percent: 80,
          awards_qualification_id: 3,
          awards_qualification_name: 'Dog walking level 1',
          active: 1,
          created_at: '2026-11-23',
          updated_at: '2026-11-23',
          question_count: 2,
        },
      ]];
    }
    if (/FROM training_questions/i.test(sql) && /WHERE module_id/i.test(sql)) {
      return [[
        {
          id: 1,
          module_id: 10,
          prompt: 'Q1',
          choices: ['a', 'b'],
          correct_index: 0,
          sort_order: 0,
        },
        {
          id: 2,
          module_id: 10,
          prompt: 'Q2',
          choices: ['a', 'b'],
          correct_index: 1,
          sort_order: 1,
        },
      ]];
    }
    if (/INSERT INTO training_attempts/i.test(sql)) {
      return [{ insertId: 55, affectedRows: 1 }];
    }
    if (/FROM training_attempts WHERE id/i.test(sql)) {
      return [[
        {
          id: 55,
          module_id: 10,
          user_id: 2,
          score_percent: 100,
          passed: 1,
          answers: params ? '[]' : '[]',
          attempted_at: '2026-11-23',
        },
      ]];
    }
    if (/FROM qualifications WHERE id/i.test(sql)) {
      return [[
        {
          id: 3,
          name: 'Dog walking level 1',
          description: null,
          validity_months: 12,
          created_at: '2026-01-01',
        },
      ]];
    }
    if (/INSERT INTO volunteer_qualifications/i.test(sql)) {
      awarded = true;
      return [{ insertId: 9, affectedRows: 1 }];
    }
    if (/FROM volunteer_qualifications vq/i.test(sql)) {
      return [[
        {
          id: 9,
          user_id: 2,
          qualification_id: 3,
          awarded_at: '2026-11-23',
          expires_at: '2027-11-23',
          awarded_by: null,
          last_expiry_notified_at: null,
          name: 'Dog walking level 1',
          description: null,
          validity_months: 12,
        },
      ]];
    }
    return [[]];
  });

  const result = await TrainingModule.recordAttempt({
    userId: 2,
    moduleId: 10,
    answers: [
      { question_id: 1, selected_index: 0 },
      { question_id: 2, selected_index: 1 },
    ],
    asOf: '2026-11-23',
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.score_percent, 100);
  assert.ok(awarded);
  assert.strictEqual(result.qualification_awarded.qualification_id, 3);
  assert.strictEqual(result.qualification_awarded.name, 'Dog walking level 1');
});

test('recordAttempt does not award when below pass mark', async () => {
  mock.resetCalls();
  let awarded = false;
  mock.setHandler(async (sql) => {
    if (/FROM training_modules m/i.test(sql) && /WHERE m\.id/i.test(sql)) {
      return [[
        {
          id: 10,
          name: 'Dog walking level 1',
          description: null,
          content: '',
          pass_mark_percent: 80,
          awards_qualification_id: 3,
          awards_qualification_name: 'Dog walking level 1',
          active: 1,
          created_at: '2026-11-23',
          updated_at: '2026-11-23',
          question_count: 2,
        },
      ]];
    }
    if (/FROM training_questions/i.test(sql)) {
      return [[
        { id: 1, module_id: 10, prompt: 'Q1', choices: ['a', 'b'], correct_index: 0, sort_order: 0 },
        { id: 2, module_id: 10, prompt: 'Q2', choices: ['a', 'b'], correct_index: 1, sort_order: 1 },
      ]];
    }
    if (/INSERT INTO training_attempts/i.test(sql)) {
      return [{ insertId: 56, affectedRows: 1 }];
    }
    if (/FROM training_attempts WHERE id/i.test(sql)) {
      return [[
        {
          id: 56,
          module_id: 10,
          user_id: 2,
          score_percent: 50,
          passed: 0,
          answers: '[]',
          attempted_at: '2026-11-23',
        },
      ]];
    }
    if (/INSERT INTO volunteer_qualifications/i.test(sql)) {
      awarded = true;
      return [{ insertId: 1, affectedRows: 1 }];
    }
    return [[]];
  });

  const result = await TrainingModule.recordAttempt({
    userId: 2,
    moduleId: 10,
    answers: [
      { question_id: 1, selected_index: 0 },
      { question_id: 2, selected_index: 0 },
    ],
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.score_percent, 50);
  assert.strictEqual(result.qualification_awarded, null);
  assert.strictEqual(awarded, false);
});

test('apply still rejects without the qualification awarded by training', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open', max_volunteers: 5 }]];
    }
    if (/FROM opportunity_qualifications/i.test(sql)) {
      return [[{ id: 3, name: 'Dog walking level 1', description: null, validity_months: 12 }]];
    }
    if (/FROM volunteer_qualifications/i.test(sql)) return [[]];
    return [[]];
  });

  const res = makeRes();
  await appCtrl.applyForOpportunity(
    { session: { userId: 2, role: 'volunteer' }, body: { opportunityId: 1 } },
    res
  );
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /missing required qualifications/i);
  assert.match(res.body.error, /Dog walking level 1/);
});
