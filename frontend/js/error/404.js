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
  let user = null;
  try {
    user = await checkAuth();
  } catch (error) {
    if (!error || !error.authUnreachable) throw error;
  }
  if (user) {
    btn.textContent = 'Go to your home page';
    btn.addEventListener('click', () => goToDashboard(user));
  } else {
    btn.textContent = 'Go to the start page';
    btn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }
});
