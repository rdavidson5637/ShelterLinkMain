import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole} from '../auth.js';

const form = document.getElementById('waiverForm');
const formTitle = document.getElementById('formTitle');
const idInput = document.getElementById('waiver_id');
const titleInput = document.getElementById('title');
const bodyInput = document.getElementById('body');
const activeInput = document.getElementById('active');
const reacceptInput = document.getElementById('requires_reacceptance');
const saveButton = document.getElementById('saveButton');
const cancelEditButton = document.getElementById('cancelEditButton');
const tableBody = document.getElementById('waiversTableBody');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

let waivers = [];
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
  if (activeInput) activeInput.checked = true;
  if (reacceptInput) reacceptInput.checked = true;
  if (formTitle) formTitle.textContent = 'Add waiver';
  if (cancelEditButton) cancelEditButton.hidden = true;
  if (saveButton) saveButton.textContent = 'Save';
}

function startEdit(w) {
  editingId = w.id;
  if (idInput) idInput.value = String(w.id);
  if (titleInput) titleInput.value = w.title || '';
  if (bodyInput) bodyInput.value = w.body || '';
  if (activeInput) activeInput.checked = Boolean(w.active);
  if (reacceptInput) reacceptInput.checked = Boolean(w.requires_reacceptance);
  if (formTitle) formTitle.textContent = `Edit waiver (v${w.version})`;
  if (cancelEditButton) cancelEditButton.hidden = false;
  if (saveButton) saveButton.textContent = 'Update';
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTable() {
  if (!tableBody) return;
  if (!waivers.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No waivers yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  waivers.forEach((w) => {
    const tr = document.createElement('tr');

    const titleTd = document.createElement('td');
    titleTd.textContent = w.title || '';

    const versionTd = document.createElement('td');
    versionTd.textContent = String(w.version ?? 1);

    const activeTd = document.createElement('td');
    activeTd.textContent = w.active ? 'Yes' : 'No';

    const reTd = document.createElement('td');
    reTd.textContent = w.requires_reacceptance ? 'Yes' : 'No';

    const actionsTd = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary button-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      setMessage();
      startEdit(w);
    });
    actionsTd.appendChild(editBtn);

    tr.appendChild(titleTd);
    tr.appendChild(versionTd);
    tr.appendChild(activeTd);
    tr.appendChild(reTd);
    tr.appendChild(actionsTd);
    tableBody.appendChild(tr);
  });
}

async function loadWaivers() {
  try {
    const res = await apiRequest('/waivers', { method: 'GET' });
    if (!res.ok) {
      setMessage('Failed to load waivers', 'error');
      waivers = [];
      renderTable();
      return;
    }
    waivers = await res.json();
    renderTable();
  } catch (error) {
    console.error('[Admin] loadWaivers error:', error);
    setMessage('Network error while loading waivers', 'error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();

  const title = (titleInput?.value || '').trim();
  const body = (bodyInput?.value || '').trim();
  if (!title || !body) {
    setMessage('Title and body are required', 'error');
    return;
  }

  const payload = {
    title,
    body,
    active: Boolean(activeInput?.checked),
    requires_reacceptance: Boolean(reacceptInput?.checked),
  };

  saveButton?.setAttribute('disabled', 'true');
  try {
    const endpoint = editingId ? `/waivers/${editingId}` : '/waivers';
    const method = editingId ? 'PUT' : 'POST';
    const res = await apiRequest(endpoint, { method, body: payload });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data?.error || 'Failed to save waiver', 'error');
      return;
    }
    const saved = await res.json();
    setMessage(
      editingId
        ? `Waiver updated (now version ${saved.version})`
        : 'Waiver created',
      'success'
    );
    resetForm();
    await loadWaivers();
  } catch (error) {
    console.error('[Admin] save waiver error:', error);
    setMessage('Network error while saving', 'error');
  } finally {
    saveButton?.removeAttribute('disabled');
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
  await loadWaivers();
}

document.addEventListener('DOMContentLoaded', init);
