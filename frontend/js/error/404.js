import { checkAuth } from '/js/auth.js';

function goToDashboard(user) {
  if (user?.role === 'admin') {
    window.location.href = '/pages/admin/dashboard.html';
  } else {
    window.location.href = '/pages/volunteer/dashboard.html';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('goButton');
  const user = await checkAuth();
  if (user) {
    btn.textContent = 'Go to Dashboard';
    btn.addEventListener('click', () => goToDashboard(user));
  } else {
    btn.textContent = 'Go to Home Page';
    btn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }
});
