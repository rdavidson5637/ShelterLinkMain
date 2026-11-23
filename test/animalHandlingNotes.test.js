'use strict';

/**
 * SL-DAY-19: volunteer-safe handling notes vs staff-only animal notes.
 * No migration — columns already exist on animals.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mock = require('./helpers/mockDb');

const ROOT = path.join(__dirname, '..');
const ANIMALS_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/animals.html'),
  'utf8'
);
const ANIMALS_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/animals.js'),
  'utf8'
);
const MY_APPS_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/volunteer/my-applications.js'),
  'utf8'
);
const CONTROLLER = fs.readFileSync(
  path.join(ROOT, 'controllers/animalController.js'),
  'utf8'
);

const {
  toPublicAnimal,
  getAnimal,
  createAnimal,
  updateAnimal,
  notesChanged,
  noteText,
} = require('../controllers/animalController');
const { stripAdminFields } = require('../controllers/opportunityController');
const { inferFromRequest } = require('../middleware/auditLog');

const AuditLog = require('../models/AuditLog');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    locals: {},
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function staffAnimalRow(overrides = {}) {
  return {
    id: 7,
    name: 'Bella',
    species: 'dog',
    breed: 'Collie',
    sex: 'F',
    status: 'available',
    kennel_ref: 'K-3',
    photo_filename: null,
    handling_notes: 'Walk with two people. No other dogs.',
    notes: 'Medication: 1 tablet with breakfast.',
    requires_qualification_id: null,
    requires_qualification_name: null,
    ...overrides,
  };
}

test('UI copy separates volunteer handling from staff-only notes', () => {
  assert.match(ANIMALS_HTML, /Volunteer handling notes/);
  assert.match(ANIMALS_HTML, /Staff-only notes/);
  assert.match(ANIMALS_HTML, /Never shown to volunteers/);
  assert.match(ANIMALS_HTML, /medication/i);
  assert.match(ANIMALS_JS, /handling_notes/);
  assert.match(ANIMALS_JS, /\bnotes\b/);
  assert.match(MY_APPS_JS, /Handling notes:/);
  assert.match(CONTROLLER, /staff-only/i);
  assert.match(CONTROLLER, /animal\.create/);
  assert.match(CONTROLLER, /animal\.update/);
});

test('toPublicAnimal never includes staff-only notes', () => {
  const animal = staffAnimalRow();
  const without = toPublicAnimal(animal, { includeHandling: false });
  assert.equal(without.handling_notes, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(without, 'notes'), false);

  const withHandling = toPublicAnimal(animal, { includeHandling: true });
  assert.equal(withHandling.handling_notes, animal.handling_notes);
  assert.equal(Object.prototype.hasOwnProperty.call(withHandling, 'notes'), false);
  assert.equal(JSON.stringify(withHandling).includes('Medication'), false);
});

test('stripAdminFields keeps handling_notes and drops staff notes', () => {
  const stripped = stripAdminFields(
    {
      title: 'Dog walk',
      animals: [staffAnimalRow()],
    },
    false
  );
  assert.equal(stripped.animals.length, 1);
  assert.equal(
    stripped.animals[0].handling_notes,
    'Walk with two people. No other dogs.'
  );
  assert.equal(Object.prototype.hasOwnProperty.call(stripped.animals[0], 'notes'), false);
  assert.equal(JSON.stringify(stripped).includes('Medication'), false);
});

test('volunteer with shift access gets handling notes only', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM animals a/i.test(sql)) return [[staffAnimalRow()]];
    if (/FROM applications/i.test(sql)) return [[{ ok: 1 }]];
    return [[]];
  });
  const res = makeRes();
  await getAnimal(
    { session: { userId: 4, role: 'volunteer' }, params: { id: '7' } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.handling_notes, 'Walk with two people. No other dogs.');
  assert.equal(res.body.notes, undefined);
  assert.equal(JSON.stringify(res.body).includes('Medication'), false);
});

test('volunteer without access cannot read handling or staff notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM animals a/i.test(sql)) return [[staffAnimalRow()]];
    return [[]];
  });
  const res = makeRes();
  await getAnimal(
    { session: { userId: 9, role: 'volunteer' }, params: { id: '7' } },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.handling_notes, undefined);
  assert.equal(res.body.notes, undefined);
});

test('staff getAnimal includes staff-only notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM animals a/i.test(sql)) return [[staffAnimalRow()]];
    if (/FROM animal_activity/i.test(sql)) return [[]];
    if (/FROM incidents/i.test(sql)) return [[]];
    return [[]];
  });
  const res = makeRes();
  await getAnimal(
    { session: { userId: 1, role: 'staff' }, params: { id: '7' } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notes, 'Medication: 1 tablet with breakfast.');
  assert.equal(res.body.handling_notes, 'Walk with two people. No other dogs.');
});

test('createAnimal audits without storing note text', async () => {
  const originalCreate = AuditLog.create;
  const audits = [];
  AuditLog.create = async (row) => {
    audits.push(row);
    return { id: 1 };
  };
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO animals/i.test(sql)) return [{ insertId: 7 }];
    if (/FROM animals a/i.test(sql)) return [[staffAnimalRow()]];
    return [[]];
  });
  try {
    const res = makeRes();
    await createAnimal(
      {
        session: { userId: 1, role: 'staff' },
        body: {
          name: 'Bella',
          handling_notes: 'Walk with two people.',
          notes: 'Medication secret',
        },
      },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'animal.create');
    assert.equal(audits[0].entityType, 'animal');
    assert.equal(audits[0].detail.handling_notes_present, true);
    assert.equal(audits[0].detail.staff_notes_present, true);
    assert.equal(JSON.stringify(audits[0]).includes('Medication'), false);
    assert.equal(JSON.stringify(audits[0]).includes('Walk with'), false);
    assert.equal(res.locals.auditWritten, true);
  } finally {
    AuditLog.create = originalCreate;
  }
});

test('updateAnimal audits note field changes without text', async () => {
  const originalCreate = AuditLog.create;
  const audits = [];
  AuditLog.create = async (row) => {
    audits.push(row);
    return { id: 2 };
  };
  mock.resetCalls();
  let call = 0;
  mock.setHandler(async (sql) => {
    if (/FROM animals a/i.test(sql)) {
      call += 1;
      if (call === 1) {
        return [[staffAnimalRow({ handling_notes: 'Old handling', notes: 'Old meds' })]];
      }
      return [[
        staffAnimalRow({
          handling_notes: 'Walk with two people. No other dogs.',
          notes: 'Medication: 1 tablet with breakfast.',
        }),
      ]];
    }
    if (/UPDATE animals/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  try {
    const res = makeRes();
    await updateAnimal(
      {
        session: { userId: 1, role: 'admin' },
        params: { id: '7' },
        body: {
          handling_notes: 'Walk with two people. No other dogs.',
          notes: 'Medication: 1 tablet with breakfast.',
        },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'animal.update');
    assert.equal(audits[0].detail.handling_notes_changed, true);
    assert.equal(audits[0].detail.staff_notes_changed, true);
    assert.equal(JSON.stringify(audits[0]).includes('Medication'), false);
    assert.equal(JSON.stringify(audits[0]).includes('Old meds'), false);
  } finally {
    AuditLog.create = originalCreate;
  }
});

test('inferFromRequest maps animal mutations', () => {
  assert.equal(
    inferFromRequest({ method: 'POST', originalUrl: '/api/animals' }).action,
    'animal.create'
  );
  assert.equal(
    inferFromRequest({ method: 'PUT', originalUrl: '/api/animals/7' }).action,
    'animal.update'
  );
});

test('notesChanged compares trimmed text', () => {
  assert.equal(noteText('  x  '), 'x');
  assert.equal(noteText(''), null);
  assert.equal(notesChanged('a', 'a'), false);
  assert.equal(notesChanged('a', 'b'), true);
  assert.equal(notesChanged(null, ''), false);
});
