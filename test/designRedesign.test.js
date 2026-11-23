'use strict';

// SL-NEXT-03: redesign guardrails from docs/DESIGN-BRIEF.md

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = path.join(ROOT, 'frontend/public/css/custom.css');
const FONTS = path.join(ROOT, 'frontend/public/fonts');

test('custom.css ships Fraunces + Source Sans 3 tokens', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  assert.match(css, /--font-display:\s*'Fraunces'/);
  assert.match(css, /--font-body:\s*'Source Sans 3'/);
  assert.match(css, /@font-face\s*\{[\s\S]*font-family:\s*'Fraunces'/);
  assert.match(css, /@font-face\s*\{[\s\S]*font-family:\s*'Source Sans 3'/);
  assert.doesNotMatch(css, /--font-stack:\s*-apple-system.*Inter/);
});

test('self-hosted latin woff2 files are present', () => {
  for (const file of [
    'fraunces-latin-400-normal.woff2',
    'fraunces-latin-600-normal.woff2',
    'fraunces-latin-700-normal.woff2',
    'source-sans-3-latin-400-normal.woff2',
    'source-sans-3-latin-600-normal.woff2',
    'source-sans-3-latin-700-normal.woff2',
  ]) {
    assert.ok(fs.existsSync(path.join(FONTS, file)), file);
  }
});

test('login and register navs do not use decorative emoji icons', () => {
  for (const rel of ['frontend/login.html', 'frontend/register.html']) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(html, /nav-icon/, rel);
    assert.doesNotMatch(html, /&#\d+;/, rel);
  }
});

test('volunteer dashboard leads with next shift, not a promo wall', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'frontend/pages/volunteer/dashboard.html'),
    'utf8'
  );
  const nextIdx = html.indexOf('id="nextShiftCard"');
  const statsIdx = html.indexOf('id="statsGrid"');
  assert.ok(nextIdx > 0, 'next shift panel present');
  assert.ok(statsIdx > nextIdx, 'next shift appears before stats grid');
  assert.match(html, /class="action-list"/);
});

test('public opportunities page uses a shift list surface', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend/pages/opportunities.html'), 'utf8');
  assert.match(html, /id="opportunitiesList"[^>]*class="[^"]*shift-list/);
});
