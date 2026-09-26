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

test('volunteer nav keeps daily items primary and tucks the rest under More', async () => {
  const { VOLUNTEER_MORE, VOLUNTEER_NAV, VOLUNTEER_PRIMARY } = await import(
    '../frontend/js/components/navConfig.js'
  );
  assert.deepEqual(
    VOLUNTEER_PRIMARY.map((item) => item.label),
    ['Home', 'Find shifts', 'Calendar', 'Messages']
  );
  assert.deepEqual(
    VOLUNTEER_MORE.map((item) => item.label),
    ['Applications', 'Hours', 'Foster', 'Transport', 'Profile']
  );
  assert.deepEqual(
    VOLUNTEER_NAV.map((item) => item.id),
    ['dashboard', 'browse', 'calendar', 'messages', 'applications', 'hours', 'foster', 'transport', 'profile']
  );
});

test('isCurrentPath treats hours subpages as Hours, and More detects those paths', async () => {
  const { isCurrentPath, volunteerMoreContainsPath } = await import(
    '../frontend/js/components/navConfig.js'
  );
  const hours = '/pages/volunteer/my-hours.html';
  assert.equal(isCurrentPath(hours, '/pages/volunteer/my-hours.html'), true);
  assert.equal(isCurrentPath(hours, '/pages/volunteer/log-hours.html'), true);
  assert.equal(isCurrentPath(hours, '/pages/volunteer/certificate.html'), true);
  assert.equal(isCurrentPath(hours, '/pages/volunteer/calendar.html'), false);
  assert.equal(volunteerMoreContainsPath('/pages/volunteer/foster.html'), true);
  assert.equal(volunteerMoreContainsPath('/pages/volunteer/log-hours.html'), true);
  assert.equal(volunteerMoreContainsPath('/pages/volunteer/dashboard.html'), false);
});
