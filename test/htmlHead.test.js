'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html') && entry.name !== 'kiosk.html') out.push(full);
  }
  return out;
}

test('every HTML page except kiosk has viewport, theme-color, manifest and apple-touch-icon', () => {
  const files = walk(path.join(__dirname, '..', 'frontend'));
  assert.ok(files.length > 10);
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<meta[^>]+name="viewport"/i, file);
    assert.match(html, /<meta[^>]+name="theme-color"/i, file);
    assert.match(html, /rel="manifest"/i, file);
    assert.match(html, /rel="apple-touch-icon"/i, file);
  }
});
