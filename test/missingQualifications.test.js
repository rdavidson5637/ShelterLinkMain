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
