import { apiRequest } from '../config.js';
import { requireAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatShiftWhen } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const posterEl = document.getElementById('poster');
const printButton = document.getElementById('printButton');

function setMessage(text) {
  messageEl.textContent = text || '';
  messageEl.className = text ? 'error-message' : '';
}

async function init() {
  document.getElementById('logoutButton')?.addEventListener('click', () => logout());
  const user = await requireAuth();
  if (!user) return;
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user);

  const id = Number(new URLSearchParams(window.location.search).get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    setMessage('Open this page from a shift on the Opportunities page.');
    return;
  }

  const res = await apiRequest(`/checkin/poster/${id}`, { method: 'GET' });
  const poster = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage(poster.error || 'Could not load this shift.');
    return;
  }

  document.getElementById('posterTitle').textContent = poster.title || 'Shift';
  document.getElementById('posterWhen').textContent = formatShiftWhen(poster.start_date, poster.end_date);
  document.getElementById('posterWhere').textContent = poster.location || '';
  document.getElementById('posterCode').textContent = poster.check_in_code;
  const qr = document.getElementById('posterQr');
  qr.addEventListener('load', () => {
    printButton.disabled = false;
  });
  qr.addEventListener('error', () => setMessage('The QR code did not load. Refresh to try again.'));
  qr.src = `/api/checkin/poster/${id}/qr.svg`;
  posterEl.hidden = false;
  printButton.addEventListener('click', () => window.print());
}

init();
