/**
 * Nav item lists and role filtering. Pure functions for unit tests.
 */

export const ADMIN_PRIMARY = [
  { id: 'dashboard', label: 'Dashboard', href: '/pages/admin/dashboard.html' },
  { id: 'shifts', label: 'Shifts', href: '/pages/admin/opportunities.html' },
  { id: 'day-sheet', label: 'Day sheet', href: '/pages/admin/day-sheet.html' },
  { id: 'week-sheet', label: 'Week sheet', href: '/pages/admin/week-sheet.html' },
  { id: 'animals', label: 'Animals', href: '/pages/admin/animals.html' },
  { id: 'fosters', label: 'Fosters', href: '/pages/admin/fosters.html' },
  { id: 'transport', label: 'Transport', href: '/pages/admin/transport.html' },
  { id: 'applications', label: 'Applications', href: '/pages/admin/review-applications.html' },
  { id: 'hours', label: 'Hours', href: '/pages/admin/approve-hours.html' },
  { id: 'volunteers', label: 'Volunteers', href: '/pages/admin/volunteers.html' },
];

export const ADMIN_MANAGE = [
  { id: 'onboarding', label: 'Onboarding', href: '/pages/admin/onboarding.html' },
  { id: 'qualifications', label: 'Qualifications', href: '/pages/admin/qualifications.html', adminOnly: true },
  { id: 'custom-fields', label: 'Custom fields', href: '/pages/admin/custom-fields.html', adminOnly: true },
  { id: 'waivers', label: 'Waivers', href: '/pages/admin/waivers.html', adminOnly: true },
  { id: 'groups', label: 'Groups', href: '/pages/admin/group-bookings.html' },
  { id: 'messages', label: 'Messages', href: '/pages/admin/threads.html' },
];

export const ADMIN_INSIGHT = [
  { id: 'reports', label: 'Reports', href: '/pages/admin/reports.html', adminOnly: true },
  { id: 'feedback', label: 'Feedback', href: '/pages/admin/feedback.html' },
  { id: 'staff-guide', label: 'Staff guide', href: '/pages/admin/staff-guide.html' },
  { id: 'audit', label: 'Audit log', href: '/pages/admin/audit-log.html', adminOnly: true },
  { id: 'privacy', label: 'Privacy and GDPR', href: '/pages/admin/privacy.html', adminOnly: true },
];

/** Daily volunteer destinations — stay visible in the top bar. */
export const VOLUNTEER_PRIMARY = [
  { id: 'dashboard', label: 'Home', href: '/pages/volunteer/dashboard.html' },
  { id: 'browse', label: 'Find shifts', href: '/pages/volunteer/browse-shifts.html' },
  { id: 'calendar', label: 'Calendar', href: '/pages/volunteer/calendar.html' },
  { id: 'messages', label: 'Messages', href: '/pages/volunteer/messages.html' },
];

/** Lower-frequency destinations — grouped under More so the bar stays one row. */
export const VOLUNTEER_MORE = [
  { id: 'applications', label: 'Applications', href: '/pages/volunteer/my-applications.html' },
  { id: 'hours', label: 'Hours', href: '/pages/volunteer/my-hours.html' },
  { id: 'foster', label: 'Foster', href: '/pages/volunteer/foster.html' },
  { id: 'transport', label: 'Transport', href: '/pages/volunteer/transport.html' },
  { id: 'profile', label: 'Profile', href: '/pages/volunteer/complete-profile.html' },
];

export const VOLUNTEER_NAV = [...VOLUNTEER_PRIMARY, ...VOLUNTEER_MORE];

/**
 * Filter nav items for a session role. Staff see a subset of admin items;
 * volunteers do not see admin destinations. Display-only: server guards remain.
 */
export function filterNavForRole(items, role) {
  const list = Array.isArray(items) ? items : [];
  if (role === 'admin') return list.slice();
  if (role === 'staff') return list.filter((item) => !item.adminOnly);
  return [];
}

export function isCurrentPath(href, pathname = '') {
  const file = String(href).split('/').pop();
  if (!file) return false;
  if (pathname.endsWith(`/${file}`) || pathname.endsWith(file)) return true;
  if (file === 'opportunities.html' && pathname.includes('create-opportunity.html')) {
    return true;
  }
  if (file === 'my-hours.html' && (pathname.includes('log-hours.html') || pathname.includes('certificate.html'))) {
    return true;
  }
  return false;
}

export function volunteerMoreContainsPath(pathname = '') {
  return VOLUNTEER_MORE.some((item) => isCurrentPath(item.href, pathname));
}
