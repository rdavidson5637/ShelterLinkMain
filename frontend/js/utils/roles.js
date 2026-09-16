/**
 * Role checks. Pass a user `{ role }` (preferred). A role string still works
 * so a mistaken `isStaffOrAdminRole(user.role)` does not bounce staff/admin.
 */
export function roleOf(userOrRole) {
  if (userOrRole == null) return '';
  if (typeof userOrRole === 'string') return userOrRole;
  return String(userOrRole.role || '');
}

export function isAdminRole(userOrRole) {
  return roleOf(userOrRole) === 'admin';
}

export function isStaffOrAdminRole(userOrRole) {
  const role = roleOf(userOrRole);
  return role === 'admin' || role === 'staff';
}
