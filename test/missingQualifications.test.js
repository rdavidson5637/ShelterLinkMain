'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('a shift qualification the volunteer does not hold is missing', async () => {
  const { missingQualifications, missingQualificationSentence } = await import(
    '../frontend/js/utils/missingQualifications.js'
  );
  const missing = missingQualifications(
    { required_qualifications: [{ id: 2, name: 'First aid' }] },
    []
  );
  assert.deepEqual(missing, [{ id: 2, name: 'First aid' }]);
  assert.equal(missingQualificationSentence(missing), 'You need First aid before you can apply.');
});

test('an animal qualification is missing even when the shift lists none', async () => {
  const { missingQualifications, missingQualificationSentence } = await import(
    '../frontend/js/utils/missingQualifications.js'
  );
  const missing = missingQualifications(
    {
      required_qualifications: [],
      animals: [
        {
          name: 'Bella',
          requires_qualification_id: 4,
          requires_qualification_name: 'Dog Handling',
        },
      ],
    },
    []
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].animalName, 'Bella');
  assert.equal(
    missingQualificationSentence(missing),
    'You need Dog Handling for Bella before you can apply.'
  );
});

test('a current award covers the animal qualification', async () => {
  const { missingQualifications } = await import('../frontend/js/utils/missingQualifications.js');
  const missing = missingQualifications(
    {
      animals: [{ name: 'Bella', requires_qualification_id: 4, requires_qualification_name: 'Dog Handling' }],
    },
    [{ qualification_id: 4, expires_at: null }],
    new Date('2026-11-02T12:00:00Z')
  );
  assert.deepEqual(missing, []);
});

test('a future expiry still covers the qualification', async () => {
  const { missingQualifications } = await import('../frontend/js/utils/missingQualifications.js');
  const missing = missingQualifications(
    { required_qualifications: [{ id: 4, name: 'Dog Handling' }] },
    [{ qualification_id: 4, expires_at: '2027-07-30' }]
  );
  assert.deepEqual(missing, []);
});

test('the same qualification is named once when the shift and the animal both require it', async () => {
  const { missingQualifications, missingQualificationSentence } = await import(
    '../frontend/js/utils/missingQualifications.js'
  );
  const missing = missingQualifications(
    {
      required_qualifications: [{ id: 4, name: 'Dog Handling' }],
      animals: [
        { name: 'Bella', requires_qualification_id: 4, requires_qualification_name: 'Dog Handling' },
      ],
    },
    []
  );
  assert.equal(missing.length, 1);
  assert.equal(
    missingQualificationSentence(missing),
    'You need Dog Handling for Bella before you can apply.'
  );
});

test('two animals that need the same qualification are named once on the card', async () => {
  const { missingQualifications, missingQualificationLabel } = await import(
    '../frontend/js/utils/missingQualifications.js'
  );
  const missing = missingQualifications(
    {
      animals: [
        { name: 'Bella', requires_qualification_id: 4, requires_qualification_name: 'Dog Handling' },
        { name: 'Rex', requires_qualification_id: 4, requires_qualification_name: 'Dog Handling' },
      ],
    },
    []
  );
  assert.equal(missing.length, 2);
  assert.equal(missingQualificationLabel(missing), 'You need Dog Handling first.');
});

test('an expired award does not cover the animal qualification', async () => {
  const { missingQualifications } = await import('../frontend/js/utils/missingQualifications.js');
  const missing = missingQualifications(
    {
      animals: [{ name: 'Bella', requires_qualification_id: 4, requires_qualification_name: 'Dog Handling' }],
    },
    [{ qualification_id: 4, expires_at: '2026-01-01' }],
    new Date('2026-11-02T12:00:00Z')
  );
  assert.equal(missing.length, 1);
});
