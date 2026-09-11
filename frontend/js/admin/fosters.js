import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';

const messageEl = document.getElementById('message');
const requestForm = document.getElementById('requestForm');
const animalSelect = document.getElementById('animal_id');
const requestsList = document.getElementById('requestsList');
const placementsList = document.getElementById('placementsList');
const logoutButton = document.getElementById('logoutButton');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error' : 'success'}">${text}</p>`;
}

function carerName(row) {
  return (
    `${row.first_name || ''} ${row.last_name || ''}`.trim() ||
    row.name ||
    row.email ||
    `User ${row.user_id}`
  );
}

function collectRequirements() {
  const requirements = {};
  const homeType = document.getElementById('req_home_type')?.value;
  const size = document.getElementById('req_max_foster_size')?.value;
  if (homeType) requirements.home_type = homeType;
  if (size) requirements.max_foster_size = size;
  if (document.getElementById('req_has_garden')?.checked) requirements.has_garden = 1;
  if (document.getElementById('req_garden_secure')?.checked) requirements.garden_secure = 1;
  if (document.getElementById('req_can_medicate')?.checked) requirements.can_medicate = 1;
  if (document.getElementById('req_no_other_cats')?.checked) requirements.has_other_cats = 0;
  if (document.getElementById('req_no_other_dogs')?.checked) requirements.has_other_dogs = 0;
  if (document.getElementById('req_no_children')?.checked) requirements.has_children_under_16 = 0;
  return requirements;
}

async function loadAnimals() {
  const res = await apiRequest('/animals');
  if (!res.ok) return;
  const animals = await res.json();
  animalSelect.innerHTML = '<option value="">Select animal…</option>';
  (animals || []).forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.name} (${a.species}) — ${a.status}`;
    animalSelect.appendChild(opt);
  });
}

async function loadRequests() {
  const res = await apiRequest('/fosters/requests?status=open');
  if (!res.ok) {
    requestsList.innerHTML = '<p class="error">Unable to load requests.</p>';
    return;
  }
  const requests = await res.json();
  if (!requests.length) {
    requestsList.innerHTML = `<div class="empty-state">
      <p>No open foster requests.</p>
      <a href="#requestForm" role="button" class="outline">Create a foster request</a>
    </div>`;
    return;
  }

  requestsList.innerHTML = '';
  for (const req of requests) {
    const article = document.createElement('article');
    article.innerHTML = `
      <header>
        <strong>${req.animal_name || `Animal #${req.animal_id}`}</strong>
        · ${req.urgency}
        · needed ${String(req.needed_from || '').slice(0, 10)}
        · ${req.pending_offers || 0} pending offer(s)
      </header>
      <p>${req.description || 'No description.'}</p>
      <div class="offers-wrap" data-request-id="${req.id}">Loading offers…</div>
      <p>
        <button type="button" class="secondary button-small cancel-request" data-id="${req.id}">Cancel request</button>
      </p>
    `;
    requestsList.appendChild(article);
    loadOffers(req.id, article.querySelector('.offers-wrap'));
  }

  requestsList.querySelectorAll('.cancel-request').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this foster request?')) return;
      const resCancel = await apiRequest(`/fosters/requests/${btn.dataset.id}/cancel`, {
        method: 'POST',
      });
      if (!resCancel.ok) {
        const body = await resCancel.json().catch(() => ({}));
        setMessage('error', body.error || 'Failed to cancel');
        return;
      }
      setMessage('success', 'Request cancelled.');
      await loadRequests();
    });
  });
}

async function loadOffers(requestId, container) {
  const res = await apiRequest(`/fosters/requests/${requestId}/offers`);
  if (!res.ok) {
    container.innerHTML = '<p class="error">Unable to load offers.</p>';
    return;
  }
  const offers = await res.json();
  if (!offers.length) {
    container.innerHTML = '<p>No offers yet.</p>';
    return;
  }

  container.innerHTML = `<ul>${offers
    .map((o) => {
      const name = carerName(o);
      return `<li>
        <strong>${name}</strong> — ${o.status}
        ${o.note ? `<br/><em>${o.note}</em>` : ''}
        ${
          o.status === 'pending'
            ? `<br/><button type="button" class="button-small confirm-offer" data-offer-id="${o.id}">Confirm</button>`
            : ''
        }
      </li>`;
    })
    .join('')}</ul>`;

  container.querySelectorAll('.confirm-offer').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Confirm this foster offer and create a placement?')) return;
      const resConfirm = await apiRequest(`/fosters/offers/${btn.dataset.offerId}/confirm`, {
        method: 'POST',
        body: {},
      });
      const body = await resConfirm.json().catch(() => ({}));
      if (!resConfirm.ok) {
        setMessage('error', body.error || 'Failed to confirm offer');
        return;
      }
      setMessage('success', 'Placement confirmed. Volunteer emailed if SMTP is configured.');
      await loadRequests();
      await loadPlacements();
    });
  });
}

async function loadPlacements() {
  const res = await apiRequest('/fosters/placements');
  if (!res.ok) {
    placementsList.innerHTML = '<p class="error">Unable to load placements.</p>';
    return;
  }
  const data = await res.json();
  const placements = data.placements || data;
  if (!placements.length) {
    placementsList.innerHTML = `<div class="empty-state">
      <p>No active placements.</p>
      <a href="#requestForm" role="button" class="outline">Create a foster request</a>
    </div>`;
    return;
  }

  placementsList.innerHTML = `<table>
    <thead>
      <tr>
        <th>Animal</th>
        <th>Carer</th>
        <th>Started</th>
        <th>Days</th>
        <th>Expected end</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${placements
        .map(
          (p) => `<tr>
        <td>${p.animal_name || p.animal_id}</td>
        <td>${carerName(p)}</td>
        <td>${String(p.started_on || '').slice(0, 10)}</td>
        <td>${p.days_elapsed != null ? p.days_elapsed : '—'}</td>
        <td>${p.expected_end_on ? String(p.expected_end_on).slice(0, 10) : '—'}</td>
        <td>
          <button type="button" class="secondary button-small end-placement" data-id="${p.id}">End</button>
        </td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>`;

  placementsList.querySelectorAll('.end-placement').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const notes = window.prompt('Outcome notes (optional):', '');
      if (notes === null) return;
      const early = confirm('Mark as returned early? Click Cancel for normal end.');
      const resEnd = await apiRequest(`/fosters/placements/${btn.dataset.id}/end`, {
        method: 'POST',
        body: {
          status: early ? 'returned_early' : 'ended',
          notes: notes.trim() || null,
          animal_status: 'available',
        },
      });
      const body = await resEnd.json().catch(() => ({}));
      if (!resEnd.ok) {
        setMessage('error', body.error || 'Failed to end placement');
        return;
      }
      setMessage('success', 'Placement ended. Animal marked available.');
      await loadPlacements();
    });
  });
}

async function handleCreate(event) {
  event.preventDefault();
  setMessage();
  const payload = {
    animal_id: Number(animalSelect.value),
    urgency: document.getElementById('urgency').value,
    needed_from: document.getElementById('needed_from').value,
    expected_duration_days: document.getElementById('expected_duration_days').value || null,
    requirements: collectRequirements(),
    description: document.getElementById('description').value || null,
  };
  const res = await apiRequest('/fosters/requests', { method: 'POST', body: payload });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage('error', body.error || 'Failed to create request');
    return;
  }
  requestForm.reset();
  setMessage('success', 'Foster request created.');
  await loadRequests();
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  applyRoleVisibility(user);
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  await loadAnimals();
  await loadRequests();
  await loadPlacements();
  requestForm?.addEventListener('submit', handleCreate);
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
}

document.addEventListener('DOMContentLoaded', init);
