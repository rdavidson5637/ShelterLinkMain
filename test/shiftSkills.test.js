'use strict';

// SL-DAY-16: per-shelter shift skills reuse qualifications; fill staff access
// and browse eligibility gaps.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('staff (not only admin) can create, update and delete shelter skills', () => {
  const routes = read('routes/qualifications.js');
  assert.match(routes, /requireStaff/);
  assert.match(routes, /router\.post\(\s*'\/',\s*isAuthenticated,\s*requireStaff/);
  assert.match(routes, /router\.put\(\s*'\/:id',\s*isAuthenticated,\s*requireStaff/);
  assert.match(routes, /router\.delete\(\s*'\/:id',\s*isAuthenticated,\s*requireStaff/);
  assert.doesNotMatch(
    routes,
    /router\.(post|put|delete)\([^)]*requireRole\(\s*'admin'\s*\)/
  );

  const ctrl = read('controllers/qualificationController.js');
  assert.match(ctrl, /async function createQualification[\s\S]*ensureStaff\(req, res\)/);
  assert.match(ctrl, /async function updateQualification[\s\S]*ensureStaff\(req, res\)/);
  assert.match(ctrl, /async function deleteQualification[\s\S]*ensureStaff\(req, res\)/);
});

test('skills catalog page is available to staff, not admin-only', () => {
  const js = read('frontend/js/admin/qualifications.js');
  assert.match(js, /isStaffOrAdminRole/);
  assert.doesNotMatch(js, /enforceAdmin/);
  assert.doesNotMatch(js, /isAdminRole\(user\)/);

  const html = read('frontend/pages/admin/qualifications.html');
  assert.match(html, /<h1>Skills<\/h1>/);
  assert.match(html, /per shelter/i);
  assert.match(html, /help\/shift-skills\.html/);
});

test('staff nav includes Skills and create-opportunity labels required skills', async () => {
  const { ADMIN_MANAGE, filterNavForRole } = await import(
    '../frontend/js/components/navConfig.js'
  );
  const item = ADMIN_MANAGE.find((i) => i.id === 'qualifications');
  assert.ok(item);
  assert.equal(item.label, 'Skills');
  assert.equal(item.adminOnly, undefined);
  const manage = filterNavForRole(ADMIN_MANAGE, 'staff').map((i) => i.id);
  assert.ok(manage.includes('qualifications'));

  const createHtml = read('frontend/pages/admin/create-opportunity.html');
  assert.match(createHtml, /Required skills/);
});

test('partitionBySkillEligibility keeps bookable shifts separate with a clear reason', async () => {
  const {
    getMissingSkills,
    skillIneligibilityReason,
    partitionBySkillEligibility,
  } = await import('../frontend/js/utils/shiftSkills.js');

  const held = [{ qualification_id: 1, expires_at: null }];
  const dogWalk = {
    title: 'Morning walks',
    required_qualifications: [{ id: 1, name: 'Dog walking' }],
  };
  const cattery = {
    title: 'Cattery tidy',
    required_qualifications: [{ id: 2, name: 'Cattery' }],
  };
  const open = { title: 'Reception', required_qualifications: [] };

  assert.deepEqual(getMissingSkills(dogWalk.required_qualifications, held), []);
  assert.equal(getMissingSkills(cattery.required_qualifications, held).length, 1);

  const { eligible, ineligible } = partitionBySkillEligibility(
    [dogWalk, cattery, open],
    (opp) => getMissingSkills(opp.required_qualifications || [], held)
  );
  assert.deepEqual(
    eligible.map((o) => o.title).sort(),
    ['Morning walks', 'Reception']
  );
  assert.equal(ineligible.length, 1);
  assert.equal(ineligible[0].opportunity.title, 'Cattery tidy');
  assert.match(ineligible[0].reason, /Not eligible for this shift/);
  assert.match(ineligible[0].reason, /Cattery/);
  assert.match(skillIneligibilityReason(ineligible[0].missing), /Cattery/);
});

test('browse shifts defaults to eligible-only and can reveal ineligible with reason', () => {
  const js = read('frontend/js/volunteer/browse-shifts.js');
  assert.match(js, /partitionBySkillEligibility/);
  assert.match(js, /show_ineligible|showIneligible|filter_show_ineligible/);
  assert.match(js, /skillIneligibilityReason|Not eligible for this shift/);

  const html = read('frontend/pages/volunteer/browse-shifts.html');
  assert.match(html, /filter_show_ineligible|Show shifts I am not eligible for/);
});

test('booking error names missing skills clearly', () => {
  const app = read('controllers/applicationController.js');
  assert.match(app, /missing required skills/i);
  const swap = read('controllers/swapController.js');
  assert.match(swap, /missing required skills/i);
});
