import { requireAuth, logout, isStaffOrAdminRole, checkAuth, applyRoleVisibility } from '/js/auth.js';

document.getElementById('logoutButton')?.addEventListener('click', (e) => {
  e.preventDefault();
  logout();
});

document.addEventListener('DOMContentLoaded', async () => {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return;
  }
  applyRoleVisibility(user);
});
