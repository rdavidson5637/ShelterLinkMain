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

// SL-LATER-12: staff / admin surfaces share the redesign tokens and stay table-first

const STAFF_PAGES = [
  'frontend/pages/admin/dashboard.html',
  'frontend/pages/admin/opportunities.html',
  'frontend/pages/admin/review-applications.html',
  'frontend/pages/admin/volunteers.html',
  'frontend/pages/admin/animals.html',
  'frontend/pages/admin/reports.html',
  'frontend/pages/admin/privacy.html',
];

test('staff admin pages load custom.css only (no extra skin over Pico)', () => {
  for (const rel of STAFF_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(html, /href="\/public\/css\/custom\.css"/, rel);
    assert.doesNotMatch(html, /design-pro|admin-skin|staff-theme\.css/, rel);
    assert.match(html, /class="[^"]*staff-app/, rel);
  }
});

test('admin dashboard is metric-strip + tables, not a card grid of stats', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'frontend/pages/admin/dashboard.html'),
    'utf8'
  );
  assert.match(html, /class="metric-strip"/);
  assert.match(html, /id="statsGrid"/);
  assert.match(html, /id="recentApplicationsTable"/);
  assert.match(html, /class="action-list"/);
  assert.doesNotMatch(html, /renderStatCards|class="stats-grid"/);
  assert.match(html, /<h1>Admin dashboard<\/h1>/);
});

test('staff list pages keep a table-first layout with page ledes', () => {
  for (const rel of [
    'frontend/pages/admin/opportunities.html',
    'frontend/pages/admin/review-applications.html',
    'frontend/pages/admin/volunteers.html',
    'frontend/pages/admin/animals.html',
  ]) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(html, /class="[^"]*page-lede/, rel);
    assert.match(html, /class="[^"]*table-wrapper[^"]*staff-dense/, rel);
    assert.match(html, /<table>/, rel);
  }
});

test('reports and privacy settings use ruled export rows, not card grids', () => {
  for (const rel of [
    'frontend/pages/admin/reports.html',
    'frontend/pages/admin/privacy.html',
  ]) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(html, /class="export-list"/, rel);
    assert.match(html, /class="[^"]*page-lede/, rel);
    assert.doesNotMatch(html, /stats-grid|three-up|feature-grid/, rel);
  }
});

test('custom.css defines staff metric strip and dense table helpers', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  assert.match(css, /\.metric-strip\s*\{/);
  assert.match(css, /\.staff-dense/);
  assert.match(css, /\.export-list\s*\{/);
  assert.doesNotMatch(css, /linear-gradient\([^)]*purple|radial-gradient\(/i);
});
