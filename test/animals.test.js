'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const Animal = require('../models/Animal');

test('normalizeAnimalIds dedupes and ignores junk', () => {
  assert.deepStrictEqual(Animal.normalizeAnimalIds([1, '2', 1, { id: 3 }, 'x']), [1, 2, 3]);
  assert.deepStrictEqual(Animal.normalizeAnimalIds(null), null);
  assert.deepStrictEqual(Animal.normalizeAnimalIds('nope'), []);
});

test('create requires a name', async () => {
  await assert.rejects(() => Animal.create({ species: 'dog' }), /name is required/);
});

test('create inserts animal and returns mapped row', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO animals/i.test(sql)) return [{ insertId: 4 }];
    if (/FROM animals a/i.test(sql)) {
      return [[{
        id: 4,
        name: 'Bella',
        species: 'dog',
        status: 'available',
        handling_notes: 'Pulls left',
        requires_qualification_id: 1,
        requires_qualification_name: 'Dog Handling',
      }]];
    }
    return [[]];
  });
  const animal = await Animal.create({
    name: 'Bella',
    species: 'dog',
    handling_notes: 'Pulls left',
    requires_qualification_id: 1,
  });
  assert.strictEqual(animal.id, 4);
  assert.strictEqual(animal.name, 'Bella');
  const ins = mock.calls.find((c) => /INSERT INTO animals/i.test(c.sql));
  assert.ok(ins);
  assert.strictEqual(ins.params[0], 'Bella');
  assert.strictEqual(ins.params[1], 'dog');
});

test('findMissingQualificationsForUser names the animal and qualification', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunity_animals/i.test(sql)) {
      return [[
        {
          id: 2,
          name: 'Rex',
          requires_qualification_id: 10,
          requires_qualification_name: 'Dog Handling',
        },
      ]];
    }
    if (/FROM volunteer_qualifications/i.test(sql) || /vq\./i.test(sql)) {
      return [[]];
    }
    return [[]];
  });
  const missing = await Animal.findMissingQualificationsForUser(5, 12);
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].animal_name, 'Rex');
  assert.strictEqual(missing[0].qualification_name, 'Dog Handling');
  assert.strictEqual(missing[0].reason, 'missing');
});

test('assertCanLogActivity requires accepted application on linked shift', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INNER JOIN opportunity_animals/i.test(sql)) {
      return [[{ application_id: 9, opportunity_id: 7, status: 'accepted' }]];
    }
    return [[]];
  });
  const ok = await Animal.assertCanLogActivity(2, 1, 9);
  assert.ok(ok);
  assert.strictEqual(ok.application_id, 9);
});

test('assertCanLogActivity returns null when not eligible', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const nope = await Animal.assertCanLogActivity(2, 1, 99);
  assert.strictEqual(nope, null);
});

test('logActivity rejects invalid activity_type', async () => {
  await assert.rejects(
    () => Animal.logActivity({ animalId: 1, userId: 2, activityType: 'cuddle' }),
    /Invalid activity_type/
  );
});

test('setStatus rejects unknown status', async () => {
  await assert.rejects(() => Animal.setStatus(1, 'escaped'), /Invalid status/);
});

test('setPhoto upserts bytes into animal_photos, not onto animals', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 1 }]);
  await Animal.setPhoto(3, { content: Buffer.from('jpegbytes'), mimeType: 'image/png' });
  const call = mock.calls.find((c) => /animal_photos/i.test(c.sql));
  assert.ok(call, 'wrote to animal_photos');
  assert.match(call.sql, /ON CONFLICT/i);
  assert.ok(Buffer.isBuffer(call.params[1]));
  assert.strictEqual(call.params[2], 'image/png');
  assert.ok(!mock.calls.some((c) => /UPDATE animals/i.test(c.sql)));
});

test('setPhoto rejects empty content', async () => {
  await assert.rejects(
    () => Animal.setPhoto(3, { content: Buffer.alloc(0) }),
    /content is required/
  );
});

test('getPhoto returns null when the animal has no photo row', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  assert.strictEqual(await Animal.getPhoto(3), null);
});

test('getPhoto returns buffer and mime when a photo row exists', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM animal_photos/i.test(sql)) {
      return [[{ content: Buffer.from('img'), mime_type: 'image/jpeg' }]];
    }
    return [[]];
  });
  const photo = await Animal.getPhoto(3);
  assert.strictEqual(photo.buffer.toString(), 'img');
  assert.strictEqual(photo.mimeType, 'image/jpeg');
});
