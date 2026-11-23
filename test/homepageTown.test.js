'use strict';

// SL-NOW-07: the homepage is served for every shelter, and shelters have no
// town on record, so the public pages must not hard-code a place name.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('homepage hero does not name a town', () => {
  const html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');
  const hero = html.match(/<section class="hero">([\s\S]*?)<\/section>/);
  assert.ok(hero, 'hero section present');
  assert.doesNotMatch(hero[1], /\bin Belfast\b/i);
  assert.match(hero[1], /Browse open shifts, apply to help/);
});

test('no public page hard-codes Belfast', () => {
  for (const file of walk(FRONTEND)) {
    const html = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /Belfast/, path.relative(FRONTEND, file));
  }
});
