'use strict';

// SL-DAY-10: public accessibility statement, footer link, and staff chrome heading / skip fixes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('accessibility statement page has a clear h1, skip target, and WCAG aim', () => {
  const html = read('frontend/pages/accessibility.html');
  assert.match(html, /<title>Accessibility statement - ShelterLink<\/title>/);
  assert.match(html, /class=["']skip-link["'][^>]*href=["']#main["']/i);
  assert.match(html, /<main[^>]*\bid=["']main["']/i);
  assert.match(html, /<h1>Accessibility statement<\/h1>/);
  assert.match(html, /WCAG 2\.1/);
  assert.match(html, /partially compliant/i);
  assert.match(html, /Last updated 23 November 2026/);
  assert.doesNotMatch(html, /fully compliant|certified|100%/i);
  assert.match(html, /href=["']\/pages\/privacy\.html["']/);
});

test('staff admin nav label is not a heading ahead of the page h1', () => {
  const src = read('frontend/js/components/adminNav.js');
  assert.match(src, /sidebar-nav-label/);
  assert.match(src, /createElement\('p'\)/);
  assert.doesNotMatch(src, /createElement\('h3'\)/);
});

test('install prompt title is not a heading ahead of the page h1', () => {
  const src = read('frontend/js/components/installPrompt.js');
  assert.match(src, /install-card-title/);
  assert.match(src, /createElement\('p'\)/);
  assert.doesNotMatch(
    src,
    /function heading\(\)\s*\{[^}]*createElement\('h[1-6]'\)/s
  );
});

test('skipLink reuses an authored skip link and focuses main', () => {
  const src = read('frontend/js/utils/skipLink.js');
  assert.match(src, /querySelector\('a\.skip-link'\)/);
  assert.match(src, /tabindex/);
  assert.match(src, /main\.focus\(\)/);
  assert.match(src, /Skip to main content/);
});

test('site footer includes Privacy and Accessibility links', () => {
  const src = read('frontend/js/utils/footerYear.js');
  assert.match(src, /\/pages\/privacy\.html/);
  assert.match(src, /privacy\.textContent = 'Privacy'/);
  assert.match(src, /\/pages\/accessibility\.html/);
  assert.match(src, /a11y\.textContent = 'Accessibility'/);
});
