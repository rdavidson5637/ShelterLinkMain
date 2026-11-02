'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('a repeating shift offers three named choices and a single shift offers two', async () => {
  const { closeShiftChoices } = await import('../frontend/js/admin/closeShiftChoice.js');

  assert.deepEqual(
    closeShiftChoices(true).map((choice) => choice.label),
    ['Just this shift', 'This and the whole series', 'Keep it']
  );
  assert.deepEqual(
    closeShiftChoices(false).map((choice) => choice.label),
    ['Close this shift', 'Keep it']
  );
});

test('dialog results map to the same DELETE calls as the old confirms', async () => {
  const { choiceFromDialog, closeShiftEndpoint } = await import(
    '../frontend/js/admin/closeShiftChoice.js'
  );

  assert.equal(choiceFromDialog('confirm', true), 'series');
  assert.equal(choiceFromDialog('extra', true), 'one');
  assert.equal(choiceFromDialog('keep', true), 'keep');
  assert.equal(choiceFromDialog('confirm', false), 'one');
  assert.equal(choiceFromDialog('extra', false), 'keep');
  assert.equal(choiceFromDialog('keep', false), 'keep');

  assert.equal(closeShiftEndpoint('one', 12), '/opportunities/12');
  assert.equal(closeShiftEndpoint('series', 12), '/opportunities/12?series=true');
  assert.equal(closeShiftEndpoint('keep', 12), null);
  assert.equal(closeShiftEndpoint('series', 'nope'), null);
});
