import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';

const form = document.getElementById('animalForm');
const photoForm = document.getElementById('photoForm');
const messageEl = document.getElementById('message');
const tableBody = document.getElementById('animalsTableBody');
const filterSpecies = document.getElementById('filterSpecies');
const filterStatus = document.getElementById('filterStatus');
const formTitle = document.getElementById('formTitle');
const cancelEditButton = document.getElementById('cancelEditButton');
const logoutButton = document.getElementById('logoutButton');
const qualSelect = document.getElementById('requires_qualification_id');
const activitySection = document.getElementById('activitySection');
const activityTitle = document.getElementById('activityTitle');
const activityTableBody = document.getElementById('activityTableBody');
const incidentsTableBody = document.getElementById('incidentsTableBody');
const incidentForm = document.getElementById('incidentForm');
const incidentAnimalId = document.getElementById('incident_animal_id');

let editingId = null;
let viewingAnimalId = null;

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error' : 'success'}">${text}</p>`;
}

function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById('animal_id').value = '';
  formTitle.textContent = 'Add animal';
  cancelEditButton.hidden = true;
  photoForm.hidden = true;
  clearFormErrors(form);
}

async function loadQualifications() {
  const res = await apiRequest('/qualifications');
  if (!res.ok) return;
  const quals = await res.json();
  qualSelect.innerHTML = '<option value="">None</option>';
  (quals || []).forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q.id;
    opt.textContent = q.name;
    qualSelect.appendChild(opt);
  });
}

async function loadAnimals() {
  const params = new URLSearchParams();
  if (filterSpecies.value) params.set('species', filterSpecies.value);
  if (filterStatus.value) params.set('status', filterStatus.value);
  const qs = params.toString() ? `?${params}` : '';
  const res = await apiRequest(`/animals${qs}`);
  if (!res.ok) {
    tableBody.innerHTML = '<tr><td colspan="6">Unable to load animals.</td></tr>';
    return;
  }
  const animals = await res.json();
  tableBody.innerHTML = '';
  if (!animals.length) {
    tableBody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <p>No animals yet.</p>
        <a href="#animalForm" role="button" class="outline">Add an animal</a>
      </div>
    </td></tr>`;
    return;
  }
  animals.forEach((animal) => {
    const tr = document.createElement('tr');
    const handling = animal.handling_notes
      ? animal.handling_notes.slice(0, 80) + (animal.handling_notes.length > 80 ? '…' : '')
      : '—';
    tr.innerHTML = `
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    `;
    const cells = tr.querySelectorAll('td');
    cells[0].textContent = animal.name;
    cells[1].textContent = animal.species;
    cells[2].textContent = animal.status;
    cells[3].textContent = animal.kennel_ref || '—';
    cells[4].textContent = handling;
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startEdit(animal));
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'secondary';
    viewBtn.textContent = 'Activity';
    viewBtn.addEventListener('click', () => loadActivity(animal));
    cells[5].appendChild(editBtn);
    cells[5].appendChild(document.createTextNode(' '));
    cells[5].appendChild(viewBtn);
    tableBody.appendChild(tr);
  });
}

function startEdit(animal) {
  editingId = animal.id;
  document.getElementById('animal_id').value = animal.id;
  document.getElementById('name').value = animal.name || '';
  document.getElementById('species').value = animal.species || 'dog';
  document.getElementById('status').value = animal.status || 'available';
  document.getElementById('breed').value = animal.breed || '';
  document.getElementById('sex').value = animal.sex || '';
  document.getElementById('kennel_ref').value = animal.kennel_ref || '';
  document.getElementById('arrival_date').value = (animal.arrival_date || '').slice(0, 10);
  document.getElementById('requires_qualification_id').value =
    animal.requires_qualification_id || '';
  document.getElementById('handling_notes').value = animal.handling_notes || '';
  document.getElementById('notes').value = animal.notes || '';
  formTitle.textContent = `Edit ${animal.name}`;
  cancelEditButton.hidden = false;
  photoForm.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadActivity(animal) {
  const res = await apiRequest(`/animals/${animal.id}`);
  if (!res.ok) {
    setMessage('error', 'Could not load activity.');
    return;
  }
  const detail = await res.json();
  viewingAnimalId = animal.id;
  activitySection.hidden = false;
  activityTitle.textContent = `Activity — ${animal.name}`;
  if (incidentAnimalId) incidentAnimalId.value = String(animal.id);
  activityTableBody.innerHTML = '';
  const rows = detail.activity || [];
  if (!rows.length) {
    activityTableBody.innerHTML = '<tr><td colspan="4">No activity logged yet.</td></tr>';
  } else {
    rows.forEach((row) => {
      const name =
        [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || `User #${row.user_id}`;
      const tr = document.createElement('tr');
      const cells = ['', '', '', ''].map(() => document.createElement('td'));
      cells[0].textContent = (row.logged_at || '').replace('T', ' ').slice(0, 16);
      cells[1].textContent = name;
      cells[2].textContent = row.activity_type;
      cells[3].textContent = row.notes || '—';
      cells.forEach((c) => tr.appendChild(c));
      activityTableBody.appendChild(tr);
    });
  }

  renderIncidents(detail.incidents || []);
}

function renderIncidents(incidents) {
  if (!incidentsTableBody) return;
  incidentsTableBody.innerHTML = '';
  if (!incidents.length) {
    incidentsTableBody.innerHTML = '<tr><td colspan="5">No incident notes yet.</td></tr>';
    return;
  }
  incidents.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = ['', '', '', '', ''].map(() => document.createElement('td'));
    cells[0].textContent = (row.created_at || '').replace('T', ' ').slice(0, 16);
    cells[1].textContent = row.severity;
    cells[2].textContent = row.reporter_name || `User #${row.reported_by}`;
    cells[3].textContent = row.body;
    if (row.resolved_at) {
      cells[4].textContent = `Resolved ${String(row.resolved_at).slice(0, 10)}`;
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = 'Resolve';
      btn.addEventListener('click', async () => {
        const res = await apiRequest(`/incidents/${row.id}/resolve`, { method: 'POST', body: {} });
        if (!res.ok) {
          setMessage('error', 'Could not resolve incident.');
          return;
        }
        if (viewingAnimalId) {
          await loadActivity({ id: viewingAnimalId, name: activityTitle.textContent.replace(/^Activity — /, '') });
        }
      });
      cells[4].appendChild(btn);
    }
    cells.forEach((c) => tr.appendChild(c));
    incidentsTableBody.appendChild(tr);
  });
}

incidentForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const animalId = incidentAnimalId?.value || viewingAnimalId;
  if (!animalId) {
    setMessage('error', 'Select an animal activity view first.');
    return;
  }
  const payload = {
    animal_id: Number(animalId),
    severity: document.getElementById('incident_severity').value,
    body: document.getElementById('incident_body').value.trim(),
  };
  if (!payload.body) {
    setMessage('error', 'Note body is required.');
    return;
  }
  const res = await apiRequest('/incidents', { method: 'POST', body: payload });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    setMessage('error', body.error || 'Could not add incident.');
    return;
  }
  document.getElementById('incident_body').value = '';
  setMessage('success', 'Incident note added.');
  await loadActivity({ id: Number(animalId), name: activityTitle.textContent.replace(/^Activity — /, '') });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors(form);
  const payload = {
    name: document.getElementById('name').value.trim(),
    species: document.getElementById('species').value,
    status: document.getElementById('status').value,
    breed: document.getElementById('breed').value.trim() || null,
    sex: document.getElementById('sex').value.trim() || null,
    kennel_ref: document.getElementById('kennel_ref').value.trim() || null,
    arrival_date: document.getElementById('arrival_date').value || null,
    requires_qualification_id: document.getElementById('requires_qualification_id').value || null,
    handling_notes: document.getElementById('handling_notes').value.trim() || null,
    notes: document.getElementById('notes').value.trim() || null,
  };
  if (!payload.name) {
    showFormErrors(form, [{ field: 'name', message: 'Name is required.' }]);
    return;
  }
  try {
    const res = editingId
      ? await apiRequest(`/animals/${editingId}`, { method: 'PUT', body: payload })
      : await apiRequest('/animals', { method: 'POST', body: payload });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Save failed');
    }
    setMessage('success', editingId ? 'Animal updated.' : 'Animal created.');
    resetForm();
    await loadAnimals();
  } catch (err) {
    setMessage('error', err.message || 'Save failed.');
  }
});

photoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingId) return;
  const file = document.getElementById('photo').files[0];
  if (!file) {
    setMessage('error', 'Choose a photo first.');
    return;
  }
  const body = new FormData();
  body.append('photo', file);
  try {
    const res = await fetch(`/api/animals/${editingId}/photo`, {
      method: 'POST',
      credentials: 'include',
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    setMessage('success', 'Photo uploaded.');
    document.getElementById('photo').value = '';
  } catch (err) {
    setMessage('error', err.message || 'Upload failed.');
  }
});

cancelEditButton.addEventListener('click', resetForm);
filterSpecies.addEventListener('change', () => loadAnimals().catch(() => {}));
filterStatus.addEventListener('change', () => loadAnimals().catch(() => {}));
if (logoutButton) logoutButton.addEventListener('click', () => logout());

(async () => {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user);
  await loadQualifications();
  await loadAnimals();
})().catch((err) => setMessage('error', err.message || 'Failed to load.'));
