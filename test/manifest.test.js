'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('manifest has id, scope, start_url, maskable icon, and files on disk', () => {
  const root = path.join(__dirname, '..', 'frontend');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8')
  );
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/launch?source=pwa');
  assert.ok((manifest.icons || []).some((icon) => String(icon.purpose).includes('maskable')));
  for (const icon of manifest.icons) {
    const rel = icon.src.replace(/^\//, '');
    const onDisk = path.join(root, rel.replace(/^public\//, 'public/'));
    assert.ok(fs.existsSync(onDisk), icon.src);
  }
});
