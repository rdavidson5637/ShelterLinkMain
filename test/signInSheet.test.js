'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/sign-in-sheet.html'),
  'utf8'
);
const PAGE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/sign-in-sheet.js'),
  'utf8'
);
const NAV = fs.readFileSync(
  path.join(ROOT, 'frontend/js/components/navConfig.js'),
  'utf8'
);
const DAY_SHEET = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/day-sheet.html'),
  'utf8'
);
const STAFF_GUIDE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/staff-guide.html'),
  'utf8'
);

test('sign-in sheet is A4 print-friendly with time in, out, and signature columns', () => {
  assert.match(PAGE, /@page\s*\{[^}]*size:\s*A4/s);
  assert.match(PAGE, /@media print/);
  assert.match(PAGE, /signin-toolbar/);
  assert.match(PAGE_JS, /Time in/);
  assert.match(PAGE_JS, /Time out/);
  assert.match(PAGE_JS, /Signature/);
  assert.match(PAGE_JS, /col-time/);
  assert.match(PAGE_JS, /col-sign/);
});

test('sign-in sheet lists booked volunteers from the staff day-sheet API', () => {
  assert.match(PAGE_JS, /\/admin\/day-sheet\?date=/);
  assert.match(PAGE_JS, /isStaffOrAdminRole/);
  assert.match(PAGE_JS, /requireAuth/);
  assert.match(PAGE_JS, /volunteers\.map\(renderVolunteerRow/);
  assert.match(PAGE_JS, /WALK_IN_ROWS/);
});

test('sign-in sheet keeps emergency contacts as a staff access note, not printed fields', () => {
  assert.match(PAGE_JS, /Staff only - emergency contacts/);
  assert.match(PAGE_JS, /signin-staff-note/);
  assert.match(PAGE_JS, /Volunteers in ShelterLink/);
  assert.doesNotMatch(PAGE_JS, /emergency_contact/);
  assert.doesNotMatch(PAGE, /emergency_contact/);
});

test('sign-in sheet supports per-shift or whole-day view', () => {
  assert.match(PAGE, /id="shiftFilter"/);
  assert.match(PAGE_JS, /All shifts this day/);
  assert.match(PAGE_JS, /opportunity_id/);
  assert.match(PAGE_JS, /shiftFilter/);
});

test('staff chrome links to the sign-in sheet', () => {
  assert.match(NAV, /sign-in-sheet\.html/);
  assert.match(NAV, /Sign-in sheet/);
  assert.match(DAY_SHEET, /sign-in-sheet\.html/);
  assert.match(STAFF_GUIDE, /sign-in-sheet\.html/);
});

test('sign-in sheet UI stays plain: no emoji grid or card collage', () => {
  assert.doesNotMatch(PAGE, /emoji|🎉|📋|✅/);
  assert.doesNotMatch(PAGE, /rounded-2xl|gradient-blob|card-grid/);
  assert.doesNotMatch(PAGE_JS, /emoji|🎉|📋/);
});
