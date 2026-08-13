import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole} from '../auth.js';

const form = document.getElementById('qualificationForm');
const formTitle = document.getElementById('formTitle');
const idInput = document.getElementById('qualification_id');
const nameInput = document.getElementById('name');
const descriptionInput = document.getElementById('description');
const validityInput = document.getElementById('validity_months');
const saveButton = document.getElementById('saveButton');
const cancelEditButton = document.getElementById('cancelEditButton');
const tableBody = document.getElementById('qualificationsTableBody');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

let qualifications = [];
let editingId = null;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function resetForm() {
  editingId = null;
  if (idInput) idInput.value = '';
  form?.reset();
  if (formTitle) formTitle.textContent = 'Add qualification';
  if (cancelEditButton) cancelEditButton.hidden = true;
  if (saveButton) saveButton.textContent = 'Save';
}

function startEdit(q) {
  editingId = q.id;
  if (idInput) idInput.value = String(q.id);
  if (nameInput) nameInput.value = q.name || '';
  if (descriptionInput) descriptionInput.value = q.description || '';
  if (validityInput) {
    validityInput.value =
      q.validity_months == null || q.validity_months === '' ? '' : String(q.validity_months);
  }
  if (formTitle) formTitle.textContent = 'Edit qualification';
  if (cancelEditButton) cancelEditButton.hidden = false;
  if (saveButton) saveButton.textContent = 'Update';
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTable() {
  if (!tableBody) return;
  if (!qualifications.length) {
    tableBody.innerHTML = '<tr><td colspan="4">No qualifications yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  qualifications.forEach((q) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = q.name || '';

    const descTd = document.createElement('td');
    descTd.textContent = q.description || '—';

    const validityTd = document.createElement('td');
    validityTd.textContent =
      q.validity_months == null ? 'Never expires' : `${q.validity_months} months`;

    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '0.5rem';
    actionsTd.style.flexWrap = 'wrap';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary button-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      setMessage();
      startEdit(q);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteQualification(q));

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deleteBtn);

    tr.appendChild(nameTd);
    tr.appendChild(descTd);
    tr.appendChild(validityTd);
    tr.appendChild(actionsTd);
    tableBody.appendChild(tr);
  });
}

async function loadQualifications() {
  try {
    const res = await apiRequest('/qualifications', { method: 'GET' });
    if (!res.ok) {
      setMessage('Failed to load qualifications', 'error');
      qualifications = [];
      renderTable();
      return;
    }
    qualifications = await res.json();
    renderTable();
  } catch (error) {
    console.error('[Admin] loadQualifications error:', error);
    setMessage('Network error while loading qualifications', 'error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();

  const name = (nameInput?.value || '').trim();
  if (!name) {
    setMessage('Name is required', 'error');
    return;
  }

  const payload = {
    name,
    description: (descriptionInput?.value || '').trim() || null,
    validity_months: validityInput?.value ? Number(validityInput.value) : null,
  };

  saveButton?.setAttribute('disabled', 'true');
  try {
    const endpoint = editingId ? `/qualifications/${editingId}` : '/qualifications';
    const method = editingId ? 'PUT' : 'POST';
    const res = await apiRequest(endpoint, { method, body: payload });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to save qualification', 'error');
      return;
    }
    setMessage(editingId ? 'Qualification updated' : 'Qualification created', 'success');
    resetForm();
    await loadQualifications();
  } catch (error) {
    console.error('[Admin] save qualification error:', error);
    setMessage('Network error while saving', 'error');
  } finally {
    saveButton?.removeAttribute('disabled');
  }
}

async function deleteQualification(q) {
  if (!window.confirm(`Delete "${q.name}"? This removes it from opportunities and volunteer awards.`)) {
    return;
  }
  try {
    const res = await apiRequest(`/qualifications/${q.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to delete', 'error');
      return;
    }
    if (editingId === q.id) resetForm();
    setMessage('Qualification deleted', 'success');
    await loadQualifications();
  } catch (error) {
    console.error('[Admin] delete qualification error:', error);
    setMessage('Network error while deleting', 'error');
  }
}

async function enforceAdmin() {
  const user = await checkAuth();
  if (!isAdminRole(user)) {
    window.location.href = '/login.html';
    return null;
  }
  return user;
}

async function init() {
  await requireAuth();
  await enforceAdmin();

  form?.addEventListener('submit', handleSubmit);
  cancelEditButton?.addEventListener('click', () => {
    setMessage();
    resetForm();
  });
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  resetForm();
  await loadQualifications();
}

document.addEventListener('DOMContentLoaded', init);
