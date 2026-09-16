'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('isStaffOrAdminRole accepts a user object or a role string', async () => {
  const { isStaffOrAdminRole, isAdminRole } = await import('../frontend/js/utils/roles.js');

  assert.equal(isStaffOrAdminRole({ role: 'admin' }), true);
  assert.equal(isStaffOrAdminRole({ role: 'staff' }), true);
  assert.equal(isStaffOrAdminRole({ role: 'volunteer' }), false);
  assert.equal(isStaffOrAdminRole(null), false);

  // Accidental `user.role` argument must still let staff/admin through.
  assert.equal(isStaffOrAdminRole('admin'), true);
  assert.equal(isStaffOrAdminRole('staff'), true);
  assert.equal(isStaffOrAdminRole('volunteer'), false);

  assert.equal(isAdminRole({ role: 'admin' }), true);
  assert.equal(isAdminRole({ role: 'staff' }), false);
  assert.equal(isAdminRole('admin'), true);
  assert.equal(isAdminRole('staff'), false);
});
