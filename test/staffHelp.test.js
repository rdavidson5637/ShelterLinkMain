'use strict';

// SL-LATER-20: in-app staff how-to pages + links from the screens they explain.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HELP_DIR = path.join(ROOT, 'frontend/pages/admin/help');

const TOPICS = [
  'post-a-shift',
  'approve-bookings',
  'trusted-volunteers',
  'shift-skills',
  'training-modules',
  'qr-check-in-poster',
  'impact-report',
  'mileage-claims',
  'two-factor',
];

const SCREEN_LINKS = [
  ['frontend/pages/admin/opportunities.html', '/pages/admin/help/post-a-shift.html'],
  ['frontend/pages/admin/opportunities.html', '/pages/admin/help/qr-check-in-poster.html'],
  ['frontend/pages/admin/create-opportunity.html', '/pages/admin/help/post-a-shift.html'],
  ['frontend/pages/admin/review-applications.html', '/pages/admin/help/approve-bookings.html'],
  ['frontend/pages/admin/review-applications.html', '/pages/admin/help/trusted-volunteers.html'],
  ['frontend/pages/admin/qualifications.html', '/pages/admin/help/shift-skills.html'],
  ['frontend/pages/admin/training.html', '/pages/admin/help/training-modules.html'],
  ['frontend/pages/admin/check-in-poster.html', '/pages/admin/help/qr-check-in-poster.html'],
  ['frontend/pages/admin/impact-report.html', '/pages/admin/help/impact-report.html'],
  ['frontend/pages/admin/approve-mileage.html', '/pages/admin/help/mileage-claims.html'],
  ['frontend/pages/admin/security.html', '/pages/admin/help/two-factor.html'],
  ['frontend/pages/admin/staff-guide.html', '/pages/admin/help/index.html'],
];

const BANNED = /\b(seamless|elevate|unlock|passionate|journey|leverage|synergy)\b|emdash|—|crafting experiences|we take pride|look no further|second to none|welcome to/i;

function headingLevels(html) {
  return [...html.matchAll(/<(h[1-6])\b/gi)].map((m) => Number(m[1][1]));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('staff help hub and topic pages exist', () => {
  assert.ok(fs.existsSync(path.join(HELP_DIR, 'index.html')));
  for (const slug of TOPICS) {
    assert.ok(fs.existsSync(path.join(HELP_DIR, `${slug}.html`)), slug);
  }
});

test('help index lists every topic as a ruled action row', () => {
  const html = read('frontend/pages/admin/help/index.html');
  assert.match(html, /class="[^"]*action-list/);
  assert.match(html, /<h1>Staff how-tos<\/h1>/);
  for (const slug of TOPICS) {
    assert.match(html, new RegExp(`/pages/admin/help/${slug}\\.html`));
  }
  assert.doesNotMatch(html, /style\s*=/);
});

test('each help page has landmarks, one h1, and no skipped headings', () => {
  const files = ['index.html', ...TOPICS.map((s) => `${s}.html`)];
  for (const file of files) {
    const html = fs.readFileSync(path.join(HELP_DIR, file), 'utf8');
    const rel = `help/${file}`;
    assert.match(html, /class=["']skip-link["'][^>]*href=["']#main["']/i, rel);
    assert.match(html, /<main[^>]*\bid=["']main["']/i, rel);
    assert.match(html, /class=["'][^"']*staff-app/, rel);
    assert.match(html, /href="\/public\/css\/custom\.css"/, rel);
    assert.match(html, /src="\/js\/admin\/staff-help\.js"/, rel);
    assert.doesNotMatch(html, BANNED, rel);
    assert.doesNotMatch(html, /nav-icon|emoji|&#\d+;/, rel);

    const levels = headingLevels(html);
    assert.equal(levels.filter((l) => l === 1).length, 1, `${rel} one h1`);
    assert.equal(levels[0], 1, `${rel} starts with h1`);
    let prev = 0;
    for (const level of levels) {
      if (prev) assert.ok(level <= prev + 1, `${rel} heading skip ${prev} -> ${level}`);
      prev = level;
    }
  }
});

test('topic pages use numbered how-to steps and link back to the live screen', () => {
  for (const slug of TOPICS) {
    const html = fs.readFileSync(path.join(HELP_DIR, `${slug}.html`), 'utf8');
    assert.match(html, /class="staff-help-steps"/, slug);
    assert.match(html, /class="staff-help-open"/, slug);
    assert.match(html, /href="\/pages\/admin\/help\/index\.html"/, slug);
    assert.match(html, /<ol class="staff-help-steps">[\s\S]*?<li>/, slug);
  }
});

test('relevant staff screens link to the matching how-to', () => {
  for (const [screen, href] of SCREEN_LINKS) {
    const html = read(screen);
    assert.match(html, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${screen} -> ${href}`);
  }
});

test('admin nav includes Staff help for staff and admin', async () => {
  const { ADMIN_INSIGHT, filterNavForRole } = await import('../frontend/js/components/navConfig.js');
  const help = ADMIN_INSIGHT.find((i) => i.id === 'staff-help');
  assert.ok(help);
  assert.equal(help.href, '/pages/admin/help/index.html');
  assert.ok(filterNavForRole(ADMIN_INSIGHT, 'staff').some((i) => i.id === 'staff-help'));
  assert.ok(filterNavForRole(ADMIN_INSIGHT, 'admin').some((i) => i.id === 'staff-help'));
});

test('staff-help CSS uses tokens and ruled steps, not card grids', () => {
  const css = read('frontend/public/css/custom.css');
  assert.match(css, /\.staff-help\s*\{[^}]*max-width:\s*var\(--measure\)/s);
  assert.match(css, /\.staff-help-steps\s*>\s*li::before/);
  assert.match(css, /Staff how-to help \(SL-LATER-20\)/);
  assert.doesNotMatch(css, /\.staff-help[^{]*\{[^}]*gradient/i);
});
