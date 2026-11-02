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
  let user = null;
  try {
    user = await checkAuth();
  } catch (error) {
    if (!error || !error.authUnreachable) throw error;
  }
  btn.addEventListener('click', () => {
    if (!user) {
      window.location.href = '/index.html';
      return;
    }
    goToDashboard(user);
  });
});
