import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole} from '../auth.js';

const form = document.getElementById('customFieldForm');
const formTitle = document.getElementById('formTitle');
const idInput = document.getElementById('field_id');
const labelInput = document.getElementById('label');
const typeInput = document.getElementById('field_type');
const optionsInput = document.getElementById('options');
const optionsLabel = document.getElementById('optionsLabel');
const requiredInput = document.getElementById('required');
const saveButton = document.getElementById('saveButton');
const cancelEditButton = document.getElementById('cancelEditButton');
const tableBody = document.getElementById('fieldsTableBody');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

let fields = [];
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

function syncOptionsVisibility() {
  const isSelect = typeInput?.value === 'select';
  if (optionsLabel) optionsLabel.hidden = !isSelect;
  if (optionsInput) optionsInput.required = isSelect;
}

function resetForm() {
  editingId = null;
  if (idInput) idInput.value = '';
  form?.reset();
  if (formTitle) formTitle.textContent = 'Add custom field';
  if (cancelEditButton) cancelEditButton.hidden = true;
  if (saveButton) saveButton.textContent = 'Save';
  syncOptionsVisibility();
}

function startEdit(field) {
  editingId = field.id;
  if (idInput) idInput.value = String(field.id);
  if (labelInput) labelInput.value = field.label || '';
  if (typeInput) typeInput.value = field.field_type || 'text';
  if (optionsInput) {
    optionsInput.value = Array.isArray(field.options) ? field.options.join('\n') : '';
  }
  if (requiredInput) requiredInput.checked = Boolean(field.required);
  if (formTitle) formTitle.textContent = 'Edit custom field';
  if (cancelEditButton) cancelEditButton.hidden = false;
  if (saveButton) saveButton.textContent = 'Update';
  syncOptionsVisibility();
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTable() {
  if (!tableBody) return;
  if (!fields.length) {
    tableBody.innerHTML = '<tr><td colspan="6">No custom fields yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  fields.forEach((field, index) => {
    const tr = document.createElement('tr');
    if (!field.active) {
      tr.style.opacity = '0.65';
    }

    const orderTd = document.createElement('td');
    orderTd.textContent = String(index + 1);

    const labelTd = document.createElement('td');
    labelTd.textContent = field.label || '';

    const typeTd = document.createElement('td');
    typeTd.textContent = field.field_type || '';

    const requiredTd = document.createElement('td');
    requiredTd.textContent = field.required ? 'Yes' : 'No';

    const statusTd = document.createElement('td');
    statusTd.textContent = field.active ? 'Active' : 'Inactive';

    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '0.5rem';
    actionsTd.style.flexWrap = 'wrap';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'secondary button-small';
    upBtn.textContent = 'Move up';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveField(index, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'secondary button-small';
    downBtn.textContent = 'Move down';
    downBtn.disabled = index === fields.length - 1;
    downBtn.addEventListener('click', () => moveField(index, 1));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary button-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      setMessage();
      startEdit(field);
    });

    const deactivateBtn = document.createElement('button');
    deactivateBtn.type = 'button';
    deactivateBtn.className = 'button-small';
    if (field.active) {
      deactivateBtn.textContent = 'Deactivate';
      deactivateBtn.addEventListener('click', () => deactivateField(field));
    } else {
      deactivateBtn.textContent = 'Reactivate';
      deactivateBtn.className = 'secondary button-small';
      deactivateBtn.addEventListener('click', () => reactivateField(field));
    }

    actionsTd.appendChild(upBtn);
    actionsTd.appendChild(downBtn);
    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deactivateBtn);

    tr.appendChild(orderTd);
    tr.appendChild(labelTd);
    tr.appendChild(typeTd);
    tr.appendChild(requiredTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionsTd);
    tableBody.appendChild(tr);
  });
}

async function loadFields() {
  try {
    const res = await apiRequest('/custom-fields', { method: 'GET' });
    if (!res.ok) {
      setMessage('Failed to load custom fields', 'error');
      fields = [];
      renderTable();
      return;
    }
    fields = await res.json();
    renderTable();
  } catch (error) {
    console.error('[Admin] loadFields error:', error);
    setMessage('Network error while loading custom fields', 'error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();

  const label = (labelInput?.value || '').trim();
  if (!label) {
    setMessage('Label is required', 'error');
    return;
  }

  const field_type = typeInput?.value || 'text';
  const options =
    field_type === 'select'
      ? (optionsInput?.value || '')
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean)
      : [];

  if (field_type === 'select' && !options.length) {
    setMessage('Select fields need at least one option', 'error');
    return;
  }

  const payload = {
    label,
    field_type,
    options,
    required: Boolean(requiredInput?.checked),
  };

  saveButton?.setAttribute('disabled', 'true');
  try {
    const endpoint = editingId ? `/custom-fields/${editingId}` : '/custom-fields';
    const method = editingId ? 'PUT' : 'POST';
    const res = await apiRequest(endpoint, { method, body: payload });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to save custom field', 'error');
      return;
    }
    setMessage(editingId ? 'Custom field updated' : 'Custom field created', 'success');
    resetForm();
    await loadFields();
  } catch (error) {
    console.error('[Admin] save custom field error:', error);
    setMessage('Network error while saving', 'error');
  } finally {
    saveButton?.removeAttribute('disabled');
  }
}

async function deactivateField(field) {
  if (!window.confirm(`Deactivate "${field.label}"? It will no longer appear on the profile form.`)) {
    return;
  }
  try {
    const res = await apiRequest(`/custom-fields/${field.id}/deactivate`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to deactivate', 'error');
      return;
    }
    if (editingId === field.id) resetForm();
    setMessage('Custom field deactivated', 'success');
    await loadFields();
  } catch (error) {
    console.error('[Admin] deactivate error:', error);
    setMessage('Network error while deactivating', 'error');
  }
}

async function reactivateField(field) {
  try {
    const res = await apiRequest(`/custom-fields/${field.id}`, {
      method: 'PUT',
      body: { active: true },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to reactivate', 'error');
      return;
    }
    setMessage('Custom field reactivated', 'success');
    await loadFields();
  } catch (error) {
    console.error('[Admin] reactivate error:', error);
    setMessage('Network error while reactivating', 'error');
  }
}

async function moveField(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= fields.length) return;
  const reordered = fields.slice();
  const [item] = reordered.splice(index, 1);
  reordered.splice(next, 0, item);
  const ordered_ids = reordered.map((f) => f.id);

  try {
    const res = await apiRequest('/custom-fields/reorder', {
      method: 'PUT',
      body: { ordered_ids },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to reorder', 'error');
      return;
    }
    fields = await res.json();
    renderTable();
    setMessage('Order updated', 'success');
  } catch (error) {
    console.error('[Admin] reorder error:', error);
    setMessage('Network error while reordering', 'error');
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
  typeInput?.addEventListener('change', syncOptionsVisibility);
  cancelEditButton?.addEventListener('click', () => {
    setMessage();
    resetForm();
  });
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  resetForm();
  await loadFields();
}

document.addEventListener('DOMContentLoaded', init);
