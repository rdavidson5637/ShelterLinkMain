import { logout } from '/js/auth.js';

document.getElementById('logoutButton')?.addEventListener('click', (e) => {
  e.preventDefault();
  logout();
});
