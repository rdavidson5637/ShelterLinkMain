'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { VENDOR_FILES } = require('../scripts/vendor-manifest');
const {
  sriSha384,
  fileMatchesIntegrity,
} = require('../scripts/ensure-vendor');

const ROOT = path.join(__dirname, '..');

function walkHtml(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkHtml(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

test('vendor manifest pins SRI sha384 digests for every CDN asset', () => {
  assert.ok(VENDOR_FILES.length >= 2);
  for (const file of VENDOR_FILES) {
    assert.match(file.integrity, /^sha384-[A-Za-z0-9+/]+=*$/);
    assert.match(file.url, /^https:\/\/cdn\.jsdelivr\.net\//);
    assert.ok(file.publicPath.startsWith('/public/'));
  }
});

test('on-disk vendor blobs match pinned SRI checksums', () => {
  for (const file of VENDOR_FILES) {
    assert.ok(
      fs.existsSync(file.dest),
      `missing ${path.relative(ROOT, file.dest)} — run npm run postinstall`
    );
    const actual = sriSha384(fs.readFileSync(file.dest));
    assert.equal(
      actual,
      file.integrity,
      `checksum mismatch for ${path.relative(ROOT, file.dest)}`
    );
    assert.equal(fileMatchesIntegrity(file.dest, file.integrity), true);
  }
});

test('HTML vendor tags carry the pinned integrity attribute', () => {
  const htmlFiles = walkHtml(path.join(ROOT, 'frontend'));
  assert.ok(htmlFiles.length > 0);

  let picoRefs = 0;
  let calendarRefs = 0;

  for (const htmlPath of htmlFiles) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    for (const file of VENDOR_FILES) {
      if (!html.includes(file.publicPath)) continue;
      if (file.publicPath.includes('pico')) picoRefs += 1;
      if (file.publicPath.includes('fullcalendar')) calendarRefs += 1;

      const tagRe = new RegExp(
        `<(?:link|script)\\b[^>]*\\b(?:href|src)="${file.publicPath.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&'
        )}"[^>]*>`,
        'g'
      );
      const tags = html.match(tagRe) || [];
      assert.ok(
        tags.length > 0,
        `${path.relative(ROOT, htmlPath)} references ${file.publicPath} without a tag`
      );
      for (const tag of tags) {
        assert.match(
          tag,
          new RegExp(`integrity="${file.integrity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
          `${path.relative(ROOT, htmlPath)} missing SRI on ${file.publicPath}`
        );
      }
    }
  }

  assert.ok(picoRefs >= 40, `expected many pico stylesheet refs, got ${picoRefs}`);
  assert.ok(calendarRefs >= 1, 'expected FullCalendar script ref');
});

test('no HTML page loads Pico or FullCalendar from a CDN URL', () => {
  const htmlFiles = walkHtml(path.join(ROOT, 'frontend'));
  for (const htmlPath of htmlFiles) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.doesNotMatch(
      html,
      /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/i,
      `${path.relative(ROOT, htmlPath)} must not load vendor assets from a CDN`
    );
  }
});
