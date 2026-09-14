'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('filterNavForRole keeps every admin item for admin', async () => {
  const { ADMIN_MANAGE, ADMIN_INSIGHT, ADMIN_PRIMARY, filterNavForRole } = await import(
    '../frontend/js/components/navConfig.js'
  );
  assert.equal(filterNavForRole(ADMIN_PRIMARY, 'admin').length, ADMIN_PRIMARY.length);
  assert.equal(filterNavForRole(ADMIN_MANAGE, 'admin').length, ADMIN_MANAGE.length);
  assert.equal(filterNavForRole(ADMIN_INSIGHT, 'admin').length, ADMIN_INSIGHT.length);
});

test('filterNavForRole hides admin-only destinations from staff', async () => {
  const { ADMIN_MANAGE, ADMIN_INSIGHT, filterNavForRole } = await import(
    '../frontend/js/components/navConfig.js'
  );
  const manage = filterNavForRole(ADMIN_MANAGE, 'staff').map((i) => i.id);
  const insight = filterNavForRole(ADMIN_INSIGHT, 'staff').map((i) => i.id);
  assert.deepEqual(manage, ['onboarding', 'groups', 'messages']);
  assert.deepEqual(insight, ['feedback', 'staff-guide']);
  assert.ok(!manage.includes('qualifications'));
  assert.ok(!manage.includes('custom-fields'));
  assert.ok(!manage.includes('waivers'));
  assert.ok(!insight.includes('reports'));
  assert.ok(!insight.includes('audit'));
  assert.ok(!insight.includes('privacy'));
});

test('filterNavForRole hides admin navigation from volunteers', async () => {
  const { ADMIN_PRIMARY, VOLUNTEER_NAV, filterNavForRole } = await import(
    '../frontend/js/components/navConfig.js'
  );
  assert.deepEqual(filterNavForRole(ADMIN_PRIMARY, 'volunteer'), []);
  assert.equal(VOLUNTEER_NAV.length, 9);
  const applications = VOLUNTEER_NAV.find((item) => item.id === 'applications');
  assert.equal(applications.href, '/pages/volunteer/my-applications.html');
});
