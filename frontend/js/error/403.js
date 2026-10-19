import { checkAuth } from '/js/auth.js';

function goToDashboard(user) {
  if (user?.role === 'admin') {
    window.location.href = '/pages/admin/dashboard.html';
  } else {
    window.location.href = '/pages/volunteer/dashboard.html';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('dashboardButton');
  const user = await checkAuth();
  btn.addEventListener('click', () => goToDashboard(user));
});
