import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const form = document.getElementById('mileageForm');
const claimsBody = document.getElementById('claimsBody');
const logoutButton = document.getElementById('logoutButton');

function setMessage(type, text) {
  if (!messageEl) return;
  messageEl.replaceChildren();
  if (!text) return;
  const p = document.createElement('p');
  p.className = type === 'error' ? 'error' : 'success';
  p.textContent = text;
  messageEl.appendChild(p);
}

function statusLabel(status) {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

async function loadClaims() {
  const res = await apiRequest('/mileage/mine');
  if (!res.ok) {
    claimsBody.innerHTML = '<tr><td colspan="4">Unable to load claims.</td></tr>';
    return;
  }
  const claims = await res.json();
  if (!claims.length) {
    claimsBody.innerHTML = '<tr><td colspan="4">No mileage claims yet.</td></tr>';
    return;
  }
  claimsBody.replaceChildren();
  claims.forEach((claim) => {
    const tr = document.createElement('tr');
    const cells = [
      formatDateOnly(claim.travel_date) || claim.travel_date || '',
      String(claim.miles),
      claim.purpose || '',
      statusLabel(claim.status),
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    claimsBody.appendChild(tr);
  });
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const travelDate = document.getElementById('travel_date').value;
  const miles = Number(document.getElementById('miles').value);
  const purpose = document.getElementById('purpose').value.trim();
  const res = await apiRequest('/mileage', {
    method: 'POST',
    body: { travel_date: travelDate, miles, purpose },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage('error', body.error || 'Could not submit claim');
    return;
  }
  setMessage('success', 'Mileage claim submitted for staff review.');
  form.reset();
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('travel_date').max = today;
  await loadClaims();
});

async function init() {
  await requireAuth();
  await checkAuth();
  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById('travel_date');
  if (dateInput) {
    dateInput.max = today;
    if (!dateInput.value) dateInput.value = today;
  }
  await loadClaims();
}

init();
