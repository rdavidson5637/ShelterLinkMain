'use strict';

// SL-LATER-14: automated accessibility checks for the redesigned surfaces.
// Markup + palette contrast (no browser). Keeps the human-designed look in place.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = path.join(ROOT, 'frontend/public/css/custom.css');

const REDESIGNED_PAGES = [
  'frontend/index.html',
  'frontend/login.html',
  'frontend/register.html',
  'frontend/forgot-password.html',
  'frontend/reset-password.html',
  'frontend/apply.html',
  'frontend/offline.html',
  'frontend/pages/opportunities.html',
  'frontend/pages/group-booking.html',
  'frontend/pages/privacy.html',
  'frontend/pages/accessibility.html',
  'frontend/pages/public/reference.html',
  'frontend/pages/volunteer/dashboard.html',
  'frontend/pages/volunteer/checkin.html',
  'frontend/pages/volunteer/certificate.html',
  'frontend/pages/volunteer/mileage.html',
  'frontend/pages/volunteer/training.html',
  'frontend/pages/admin/dashboard.html',
  'frontend/pages/admin/opportunities.html',
  'frontend/pages/admin/review-applications.html',
  'frontend/pages/admin/volunteers.html',
  'frontend/pages/admin/animals.html',
  'frontend/pages/admin/reports.html',
  'frontend/pages/admin/privacy.html',
  'frontend/pages/admin/check-in-poster.html',
  'frontend/pages/admin/approve-mileage.html',
  'frontend/pages/admin/training.html',
];

function walkHtml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(ROOT, file);
}

function luminance(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

function token(css, name) {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`);
  const m = css.match(re);
  assert.ok(m, `token --${name} missing`);
  return m[1];
}

function headingLevels(html) {
  return [...html.matchAll(/<(h[1-6])\b/gi)].map((m) => Number(m[1][1]));
}

function controlHasAccessibleName(html, tag) {
  if (/\btype\s*=\s*["']hidden["']/i.test(tag)) return true;
  if (/\btype\s*=\s*["']submit["']/i.test(tag)) return true;
  if (/\btype\s*=\s*["']button["']/i.test(tag)) return true;
  if (/\btype\s*=\s*["']image["']/i.test(tag)) return /\balt\s*=/.test(tag);
  if (/\baria-label\s*=/.test(tag) || /\baria-labelledby\s*=/.test(tag)) return true;
  if (/\btitle\s*=/.test(tag)) return true;

  const id = (tag.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
  if (id) {
    const forRe = new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
    if (forRe.test(html)) return true;
  }

  // Wrapped <label>…control…</label>
  const idx = html.indexOf(tag);
  if (idx >= 0) {
    const before = html.slice(Math.max(0, idx - 400), idx);
    const open = before.lastIndexOf('<label');
    const close = before.lastIndexOf('</label>');
    if (open > close) return true;
  }
  return false;
}

test('redesign palette meets WCAG AA for text and controls', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  const pairs = [
    ['text on page-bg', token(css, 'text'), token(css, 'page-bg')],
    ['text on surface', token(css, 'text'), token(css, 'surface')],
    ['text-secondary on page-bg', token(css, 'text-secondary'), token(css, 'page-bg')],
    ['text-secondary on surface', token(css, 'text-secondary'), token(css, 'surface')],
    ['text-muted on surface', token(css, 'text-muted'), token(css, 'surface')],
    ['on-primary on green', token(css, 'on-primary'), token(css, 'green')],
    ['green on surface (links)', token(css, 'green'), token(css, 'surface')],
    ['green on green-tint (badges)', token(css, 'green'), token(css, 'green-tint')],
    ['accent-ink on accent', token(css, 'accent-ink'), token(css, 'accent')],
    ['accent-text on surface', token(css, 'accent-text'), token(css, 'surface')],
    ['warning-text on warning-tint', token(css, 'warning-text'), token(css, 'warning-tint')],
    ['danger on surface', token(css, 'danger'), token(css, 'surface')],
    ['danger on danger-tint', token(css, 'danger'), token(css, 'danger-tint')],
    ['on-unread on unread', token(css, 'on-unread'), token(css, 'unread')],
  ];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 (${fg} on ${bg})`);
  }
  // Accent must not be used as body text on light surfaces (fails AA).
  assert.ok(contrastRatio(token(css, 'accent'), token(css, 'surface')) < 4.5);
  assert.doesNotMatch(css, /(?:^|[^-])color:\s*var\(--accent\)\s*;/m);
});

test('custom.css keeps visible focus and reduced-motion', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  assert.match(css, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /transition:\s*none\s*!important/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--green\)/s);
  assert.match(css, /\.skip-link:focus/);
});

test('every HTML page is well-formed for landmarks and skip link', () => {
  const files = walkHtml(path.join(ROOT, 'frontend')).filter(
    (f) => !f.endsWith(`${path.sep}kiosk.html`)
  );
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = relative(file);
    assert.equal((html.match(/<body\b/gi) || []).length, 1, `${rel} body count`);
    assert.equal((html.match(/<\/head>/gi) || []).length, 1, `${rel} </head> count`);
    assert.equal(
      (html.match(/class=["']skip-link["']/g) || []).length,
      1,
      `${rel} skip-link count`
    );
    assert.match(html, /class=["']skip-link["'][^>]*href=["']#main["']/i, rel);
    assert.match(html, /<main[^>]*\bid=["']main["']/i, rel);
    const skipIdx = html.search(/class=["']skip-link["']/i);
    const mainIdx = html.search(/<main\b/i);
    assert.ok(skipIdx >= 0 && skipIdx < mainIdx, `${rel} skip link before main`);
  }
});

test('redesigned pages keep one h1 and no skipped heading levels', () => {
  for (const rel of REDESIGNED_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const levels = headingLevels(html);
    assert.ok(levels.length >= 1, `${rel} has headings`);
    assert.equal(levels.filter((l) => l === 1).length, 1, `${rel} exactly one h1`);
    assert.equal(levels[0], 1, `${rel} starts with h1`);
    let prev = 0;
    for (const level of levels) {
      if (prev) {
        assert.ok(level <= prev + 1, `${rel} heading skip ${prev} -> ${level}`);
      }
      prev = level;
    }
  }
});

test('every staff and volunteer page has one h1 and a #main skip target', () => {
  const roots = [
    path.join(ROOT, 'frontend/pages/admin'),
    path.join(ROOT, 'frontend/pages/volunteer'),
  ];
  const files = roots.flatMap((dir) => walkHtml(dir));
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = relative(file);
    assert.match(html, /class=["']skip-link["'][^>]*href=["']#main["']/i, rel);
    assert.match(html, /<main[^>]*\bid=["']main["']/i, rel);
    const levels = headingLevels(html);
    assert.equal(levels.filter((l) => l === 1).length, 1, `${rel} exactly one h1`);
    assert.equal(levels[0], 1, `${rel} starts with h1`);
  }
});

test('static form controls on redesigned pages have accessible names', () => {
  for (const rel of REDESIGNED_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)].map((m) => m[0]);
    for (const tag of controls) {
      assert.ok(
        controlHasAccessibleName(html, tag),
        `${rel} unlabeled control: ${tag.slice(0, 120)}`
      );
    }
  }
});

test('img tags declare alt text (empty allowed when decorative)', () => {
  const files = walkHtml(path.join(ROOT, 'frontend'));
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      assert.match(m[0], /\balt\s*=/, `${relative(file)} img missing alt`);
    }
  }
  for (const rel of [
    'frontend/js/components/opportunityModal.js',
    'frontend/js/admin/day-sheet.js',
    'frontend/js/admin/week-sheet.js',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/<img\b[^>]*>/g)) {
      assert.match(m[0], /\balt=/, `${rel} dynamic img missing alt`);
    }
  }
});

test('native dialogs used on redesigned pages expose a name', () => {
  for (const rel of REDESIGNED_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of html.matchAll(/<dialog\b[^>]*>/gi)) {
      assert.match(
        m[0],
        /\baria-labelledby\s*=|\baria-label\s*=/i,
        `${rel} dialog needs accessible name: ${m[0]}`
      );
    }
  }
});
