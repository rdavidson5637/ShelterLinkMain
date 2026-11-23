import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';

const form = document.getElementById('inductionForm');
const formTitle = document.getElementById('formTitle');
const idInput = document.getElementById('item_id');
const titleInput = document.getElementById('title');
const sortInput = document.getElementById('sort_order');
const saveButton = document.getElementById('saveButton');
const cancelEditButton = document.getElementById('cancelEditButton');
const tableBody = document.getElementById('inductionTableBody');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');
const starterButton = document.getElementById('starterButton');
const starterHint = document.getElementById('starterHint');

let items = [];
let editingId = null;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  const note = document.createElement('p');
  if (cls) note.className = cls;
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function resetForm() {
  editingId = null;
  if (idInput) idInput.value = '';
  form?.reset();
  if (formTitle) formTitle.textContent = 'Add checklist item';
  if (cancelEditButton) cancelEditButton.hidden = true;
  if (saveButton) saveButton.textContent = 'Save';
}

function startEdit(item) {
  editingId = item.id;
  if (idInput) idInput.value = String(item.id);
  if (titleInput) titleInput.value = item.title || '';
  if (sortInput) sortInput.value = item.sort_order == null ? '' : String(item.sort_order);
  if (formTitle) formTitle.textContent = 'Edit checklist item';
  if (cancelEditButton) cancelEditButton.hidden = false;
  if (saveButton) saveButton.textContent = 'Update';
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTable() {
  if (!tableBody) return;
  if (starterHint) {
    starterHint.hidden = items.length > 0;
  }
  if (starterButton) {
    starterButton.hidden = items.length > 0;
  }

  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="4">No induction items yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  items.forEach((item) => {
    const tr = document.createElement('tr');

    const orderTd = document.createElement('td');
    orderTd.textContent = String(item.sort_order ?? 0);

    const titleTd = document.createElement('td');
    titleTd.textContent = item.title || '';

    const statusTd = document.createElement('td');
    statusTd.textContent = item.active ? 'Active' : 'Inactive';

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
      startEdit(item);
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'secondary button-small';
    toggleBtn.textContent = item.active ? 'Deactivate' : 'Reactivate';
    toggleBtn.addEventListener('click', () => toggleActive(item));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteItem(item));

    actionsTd.append(editBtn, toggleBtn, deleteBtn);
    tr.append(orderTd, titleTd, statusTd, actionsTd);
    tableBody.appendChild(tr);
  });
}

async function loadItems() {
  const res = await apiRequest('/induction-checklist/items', { method: 'GET' });
  if (!res.ok) {
    tableBody.innerHTML = '<tr><td colspan="4">Unable to load checklist.</td></tr>';
    setMessage('Unable to load induction checklist.', 'error');
    return;
  }
  const data = await res.json();
  items = Array.isArray(data.items) ? data.items : [];
  renderTable();
}

async function saveItem(event) {
  event.preventDefault();
  setMessage();
  const title = titleInput?.value?.trim() || '';
  if (!title) {
    setMessage('Enter a checklist item title.', 'error');
    return;
  }
  const body = { title };
  if (sortInput?.value !== '' && sortInput?.value != null) {
    body.sort_order = Number(sortInput.value);
  }

  const editing = editingId != null;
  const res = await apiRequest(
    editing ? `/induction-checklist/items/${editingId}` : '/induction-checklist/items',
    {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Unable to save item.', 'error');
    return;
  }
  setMessage(editing ? 'Checklist item updated.' : 'Checklist item added.', 'success');
  resetForm();
  await loadItems();
}

async function toggleActive(item) {
  setMessage();
  const res = await apiRequest(`/induction-checklist/items/${item.id}`, {
    method: 'PUT',
    body: JSON.stringify({ active: !item.active }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Unable to update item.', 'error');
    return;
  }
  setMessage(item.active ? 'Item deactivated.' : 'Item reactivated.', 'success');
  await loadItems();
}

async function deleteItem(item) {
  if (!window.confirm(`Delete "${item.title}"? Progress ticks for this item will be removed.`)) {
    return;
  }
  setMessage();
  const res = await apiRequest(`/induction-checklist/items/${item.id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Unable to delete item.', 'error');
    return;
  }
  setMessage('Checklist item deleted.', 'success');
  if (editingId === item.id) resetForm();
  await loadItems();
}

async function addStarter() {
  setMessage();
  const res = await apiRequest('/induction-checklist/items/starter', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Unable to add starter checklist.', 'error');
    return;
  }
  setMessage('Starter induction checklist added.', 'success');
  await loadItems();
}

async function init() {
  requireAuth();
  const user = await checkAuth();
  if (!user || !isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user);
  logoutButton?.addEventListener('click', () => logout());
  cancelEditButton?.addEventListener('click', () => {
    setMessage();
    resetForm();
  });
  form?.addEventListener('submit', saveItem);
  starterButton?.addEventListener('click', addStarter);
  await loadItems();
}

init().catch((error) => {
  console.error('[Induction] init error:', error);
  setMessage('Unable to load induction checklist.', 'error');
});
