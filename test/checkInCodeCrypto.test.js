'use strict';

/**
 * SL-LATER-09: kiosk / shift check-in codes (and other codes or tokens) must
 * come from crypto, never Math.random.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const Opportunity = require('../models/Opportunity');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['models', 'controllers', 'services', 'utils', 'middleware', 'routes'];

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('generateCheckInCode uses crypto.randomInt and never Math.random', () => {
  const src = fs.readFileSync(path.join(ROOT, 'models', 'Opportunity.js'), 'utf8');
  assert.match(src, /function generateCheckInCode\([\s\S]*?crypto\.randomInt/);
  assert.equal(/Math\.random/.test(src), false);

  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must not be used for check-in codes');
  };
  try {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const code = Opportunity.generateCheckInCode();
      assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      seen.add(code);
    }
    assert.ok(seen.size > 190, 'codes should not repeat in a small sample');
  } finally {
    Math.random = original;
  }
});

test('production JS does not use Math.random for codes or tokens', () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkJs(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      if (!/Math\.random/.test(src)) continue;
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Math.random found in: ${offenders.join(', ') || '(none)'}`
  );
});
