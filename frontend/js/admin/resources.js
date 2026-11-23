import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';

const linkForm = document.getElementById('linkForm');
const fileForm = document.getElementById('fileForm');
const tableBody = document.getElementById('resourcesTableBody');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

let items = [];

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

function renderTable() {
  if (!tableBody) return;
  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No resources yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  items.forEach((item) => {
    const tr = document.createElement('tr');

    const orderTd = document.createElement('td');
    orderTd.textContent = String(item.sort_order ?? 0);

    const titleTd = document.createElement('td');
    if (item.kind === 'link' && item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.title || '';
      titleTd.appendChild(a);
    } else if (item.kind === 'file') {
      const a = document.createElement('a');
      a.href = `/api/resources/${item.id}/download`;
      a.textContent = item.title || item.original_name || 'File';
      titleTd.appendChild(a);
      if (item.original_name) {
        const small = document.createElement('small');
        small.textContent = ` (${item.original_name})`;
        titleTd.appendChild(small);
      }
    } else {
      titleTd.textContent = item.title || '';
    }

    const typeTd = document.createElement('td');
    typeTd.textContent = item.kind === 'file' ? 'File' : 'Link';

    const statusTd = document.createElement('td');
    statusTd.textContent = item.active ? 'Active' : 'Inactive';

    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '0.5rem';
    actionsTd.style.flexWrap = 'wrap';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'secondary button-small';
    toggleBtn.textContent = item.active ? 'Deactivate' : 'Reactivate';
    toggleBtn.addEventListener('click', () => toggleActive(item));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'secondary button-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteItem(item));

    actionsTd.append(toggleBtn, deleteBtn);
    tr.append(orderTd, titleTd, typeTd, statusTd, actionsTd);
    tableBody.appendChild(tr);
  });
}

async function loadItems() {
  const res = await apiRequest('/resources?all=1', { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load resources');
  }
  const data = await res.json();
  items = Array.isArray(data.items) ? data.items : [];
  renderTable();
}

async function toggleActive(item) {
  setMessage();
  const res = await apiRequest(`/resources/${item.id}`, {
    method: 'PUT',
    body: JSON.stringify({ active: item.active ? 0 : 1 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not update resource', 'error');
    return;
  }
  setMessage(item.active ? 'Resource deactivated.' : 'Resource reactivated.', 'success');
  await loadItems();
}

async function deleteItem(item) {
  if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
  setMessage();
  const res = await apiRequest(`/resources/${item.id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not delete resource', 'error');
    return;
  }
  setMessage('Resource deleted.', 'success');
  await loadItems();
}

linkForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage();
  const title = document.getElementById('link_title')?.value || '';
  const url = document.getElementById('link_url')?.value || '';
  const sortRaw = document.getElementById('link_sort_order')?.value;
  const body = { title, url };
  if (sortRaw !== '' && sortRaw != null) body.sort_order = Number(sortRaw);

  const res = await apiRequest('/resources/links', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not add link', 'error');
    return;
  }
  linkForm.reset();
  setMessage('Link added.', 'success');
  await loadItems();
});

fileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage();
  const title = document.getElementById('file_title')?.value || '';
  const fileInput = document.getElementById('file_input');
  const file = fileInput?.files?.[0];
  if (!file) {
    setMessage('Choose a file to upload.', 'error');
    return;
  }
  const formData = new FormData();
  formData.append('title', title);
  formData.append('file', file);
  const sortRaw = document.getElementById('file_sort_order')?.value;
  if (sortRaw !== '' && sortRaw != null) formData.append('sort_order', sortRaw);

  // Use fetch directly so FormData sets multipart boundaries (apiRequest forces JSON).
  const res = await fetch(`${API_URL}/resources/files`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not upload file', 'error');
    return;
  }
  fileForm.reset();
  setMessage('File uploaded.', 'success');
  await loadItems();
});

logoutButton?.addEventListener('click', () => logout());

(async function init() {
  requireAuth();
  const session = await checkAuth();
  if (!session || !isStaffOrAdminRole(session.role)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(session.role);
  try {
    await loadItems();
  } catch (error) {
    setMessage(error.message || 'Could not load resources', 'error');
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="5">Could not load resources.</td></tr>';
  }
})();
