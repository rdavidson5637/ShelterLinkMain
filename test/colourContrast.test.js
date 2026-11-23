'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateBrandColour,
  tokensForStoredColour,
  contrastRatio,
  parseHex,
  AA_NORMAL,
} = require('../utils/colourContrast');

test('default teal passes AA against white', () => {
  const result = evaluateBrandColour('#0f766e');
  assert.equal(result.ok, true);
  assert.equal(result.hex, '#0f766e');
  assert.ok(result.ratio >= AA_NORMAL);
  assert.equal(result.tokens.green, '#0f766e');
  assert.equal(result.tokens.onPrimary, '#ffffff');
  assert.match(result.tokens.selection, /^rgba\(15, 118, 110,/);
});

test('near-white accent is rejected so the default palette stays', () => {
  const result = evaluateBrandColour('#eeeeee');
  assert.equal(result.ok, false);
  assert.match(result.error, /WCAG AA|contrast/i);
  assert.equal(tokensForStoredColour('#eeeeee'), null);
});

test('null or empty colour clears to default tokens', () => {
  assert.deepEqual(evaluateBrandColour(null), {
    ok: true,
    hex: null,
    ratio: null,
    tokens: null,
  });
  assert.deepEqual(evaluateBrandColour(''), {
    ok: true,
    hex: null,
    ratio: null,
    tokens: null,
  });
  assert.equal(tokensForStoredColour(null), null);
});

test('invalid hex is rejected', () => {
  assert.equal(evaluateBrandColour('0f766e').ok, false);
  assert.equal(evaluateBrandColour('#fff').ok, false);
  assert.equal(evaluateBrandColour('red').ok, false);
  assert.equal(parseHex('#0F766E').hex, '#0f766e');
});

test('black has a high contrast ratio on white', () => {
  const black = parseHex('#000000');
  const white = parseHex('#ffffff');
  assert.ok(contrastRatio(black, white) > 20);
});
