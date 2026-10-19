'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('HTML has no inline scripts or on* attributes', () => {
  const files = walk(path.join(__dirname, '..', 'frontend'));
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, `inline script in ${file}`);
    assert.equal(/\son[a-zA-Z]+=/.test(html), false, `on* attribute in ${file}`);
  }
});
