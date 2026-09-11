import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';

const messageEl = document.getElementById('message');
const runForm = document.getElementById('runForm');
const animalSelect = document.getElementById('animal_id');
const legsEditor = document.getElementById('legsEditor');
const addLegBtn = document.getElementById('addLegBtn');
const runsList = document.getElementById('runsList');
const filterStatus = document.getElementById('filterStatus');
const logoutButton = document.getElementById('logoutButton');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error' : 'success'}">${text}</p>`;
}

function addLegRow(defaults = {}) {
  const row = document.createElement('div');
  row.className = 'form-grid leg-row';
  row.innerHTML = `
    <label>From
      <input type="text" class="leg-from" required value="${defaults.from || ''}" />
    </label>
    <label>To
      <input type="text" class="leg-to" required value="${defaults.to || ''}" />
    </label>
    <label>Miles
      <input type="number" class="leg-miles" min="0" step="0.1" value="${defaults.miles || ''}" />
    </label>
    <button type="button" class="secondary remove-leg">Remove</button>
  `;
  row.querySelector('.remove-leg').addEventListener('click', () => {
    if (legsEditor.querySelectorAll('.leg-row').length > 1) row.remove();
  });
  legsEditor.appendChild(row);
}

function collectLegs() {
  return Array.from(legsEditor.querySelectorAll('.leg-row')).map((row, i) => ({
    leg_order: i + 1,
    from_location: row.querySelector('.leg-from').value.trim(),
    to_location: row.querySelector('.leg-to').value.trim(),
    distance_miles: row.querySelector('.leg-miles').value || null,
  }));
}

async function loadAnimals() {
  const res = await apiRequest('/animals');
  if (!res.ok) return;
  const animals = await res.json();
  animalSelect.innerHTML = '<option value="">None</option>';
  (animals || []).forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.name} (${a.species})`;
    animalSelect.appendChild(opt);
  });
}

async function loadRuns() {
  const qs = filterStatus.value ? `?status=${encodeURIComponent(filterStatus.value)}` : '';
  const res = await apiRequest(`/transport${qs}`);
  if (!res.ok) {
    runsList.innerHTML = '<p class="error">Unable to load runs.</p>';
    return;
  }
  const runs = await res.json();
  if (!runs.length) {
    runsList.innerHTML = `<p class="empty-state">No transport runs yet. <a href="#runForm">Create a run</a> with ordered legs for drivers to claim.</p>`;
    return;
  }
  runsList.innerHTML = '';
  for (const run of runs) {
    const article = document.createElement('article');
    article.innerHTML = `
      <header>
        <strong>${run.title}</strong>
        · ${String(run.run_date || '').slice(0, 10)}
        · ${run.status}
        · ${run.claimed_count || 0}/${run.leg_count || 0} legs claimed
        ${run.animal_name ? `· ${run.animal_name}` : ''}
      </header>
      <div class="run-detail" data-run-id="${run.id}">Loading legs…</div>
      <p>
        <button type="button" class="secondary chase-btn" data-run-id="${run.id}">Chase for cover</button>
        <button type="button" class="secondary cancel-btn" data-run-id="${run.id}">Cancel run</button>
      </p>
    `;
    runsList.appendChild(article);
    loadRunDetail(run.id, article.querySelector('.run-detail'));
  }

  runsList.querySelectorAll('.chase-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await apiRequest(`/transport/${btn.dataset.runId}/chase`, { method: 'POST', body: {} });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage('error', body.error || 'Chase failed');
        return;
      }
      setMessage('success', `Chase sent to ${body.sent || 0} volunteer(s).`);
    });
  });
  runsList.querySelectorAll('.cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await apiRequest(`/transport/${btn.dataset.runId}/status`, {
        method: 'PUT',
        body: { status: 'cancelled' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage('error', body.error || 'Cancel failed');
        return;
      }
      setMessage('success', 'Run cancelled.');
      await loadRuns();
    });
  });
}

async function loadRunDetail(runId, el) {
  const res = await apiRequest(`/transport/${runId}`);
  if (!res.ok) {
    el.textContent = 'Could not load legs.';
    return;
  }
  const detail = await res.json();
  const legs = detail.legs || [];
  if (!legs.length) {
    el.textContent = 'No legs.';
    return;
  }
  const list = document.createElement('ol');
  legs.forEach((leg) => {
    const li = document.createElement('li');
    const who = leg.claimer_name
      ? `${leg.claimer_name}${leg.claimer_email ? ` (${leg.claimer_email})` : ''}`
      : 'unclaimed';
    li.textContent = `${leg.from_location} → ${leg.to_location} — ${who}${
      leg.completed_at ? ' · completed' : ''
    }`;
    list.appendChild(li);
  });
  el.innerHTML = '';
  el.appendChild(list);
}

runForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const legs = collectLegs();
  if (!legs.length || legs.some((l) => !l.from_location || !l.to_location)) {
    setMessage('error', 'Each leg needs from and to locations.');
    return;
  }
  const payload = {
    title: document.getElementById('title').value.trim(),
    run_date: document.getElementById('run_date').value,
    animal_id: animalSelect.value || null,
    notes: document.getElementById('notes').value.trim() || null,
    legs,
  };
  const res = await apiRequest('/transport', { method: 'POST', body: payload });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    setMessage('error', body.error || 'Could not create run');
    return;
  }
  setMessage('success', 'Transport run created.');
  runForm.reset();
  legsEditor.innerHTML = '';
  addLegRow();
  addLegRow();
  await loadRuns();
});

addLegBtn?.addEventListener('click', () => addLegRow());
filterStatus?.addEventListener('change', () => loadRuns());

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
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById('run_date');
  if (dateInput && !dateInput.value) dateInput.value = today;
  addLegRow();
  addLegRow();
  await loadAnimals();
  await loadRuns();
}

init();
