import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const claimsBody = document.getElementById('claimsBody');
const totalsBody = document.getElementById('totalsBody');
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

function volunteerName(row) {
  return `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Volunteer';
}

async function loadPending() {
  const res = await apiRequest('/mileage/pending');
  if (!res.ok) {
    claimsBody.innerHTML = '<tr><td colspan="5">Unable to load pending claims.</td></tr>';
    return;
  }
  const claims = await res.json();
  if (!claims.length) {
    claimsBody.innerHTML = '<tr><td colspan="5">No pending mileage claims.</td></tr>';
    return;
  }
  claimsBody.replaceChildren();
  claims.forEach((claim) => {
    const tr = document.createElement('tr');
    tr.dataset.claimId = String(claim.id);

    const nameTd = document.createElement('td');
    nameTd.textContent = volunteerName(claim);
    tr.appendChild(nameTd);

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDateOnly(claim.travel_date) || claim.travel_date || '';
    tr.appendChild(dateTd);

    const milesTd = document.createElement('td');
    milesTd.textContent = String(claim.miles);
    tr.appendChild(milesTd);

    const purposeTd = document.createElement('td');
    purposeTd.textContent = claim.purpose || '';
    tr.appendChild(purposeTd);

    const actionsTd = document.createElement('td');
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => reviewClaim(claim.id, 'approve'));
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'secondary';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => reviewClaim(claim.id, 'reject'));
    actionsTd.appendChild(approveBtn);
    actionsTd.appendChild(document.createTextNode(' '));
    actionsTd.appendChild(rejectBtn);
    tr.appendChild(actionsTd);

    claimsBody.appendChild(tr);
  });
}

async function loadTotals() {
  const res = await apiRequest('/mileage/totals');
  if (!res.ok) {
    totalsBody.innerHTML = '<tr><td colspan="3">Unable to load totals.</td></tr>';
    return;
  }
  const totals = await res.json();
  if (!totals.length) {
    totalsBody.innerHTML = '<tr><td colspan="3">No approved mileage yet.</td></tr>';
    return;
  }
  totalsBody.replaceChildren();
  totals.forEach((row) => {
    const tr = document.createElement('tr');
    [volunteerName(row), String(row.claim_count), String(row.total_miles)].forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    totalsBody.appendChild(tr);
  });
}

async function reviewClaim(id, action) {
  const res = await apiRequest(`/mileage/${id}/${action}`, { method: 'PUT', body: {} });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage('error', body.error || `Could not ${action} claim`);
    return;
  }
  setMessage('success', action === 'approve' ? 'Claim approved.' : 'Claim rejected.');
  await loadPending();
  await loadTotals();
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return;
  }
  applyRoleVisibility(user);
  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
  await loadPending();
  await loadTotals();
}

init();
