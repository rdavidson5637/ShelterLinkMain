import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout } from '../auth.js';

const listEl = document.getElementById('resourceList');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const note = document.createElement('p');
  if (tone === 'error') note.className = 'error';
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function renderItems(items) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No resources yet. Staff can add handbooks and links from the admin Resources page.';
    listEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const a = document.createElement('a');
    const title = document.createElement('strong');
    title.textContent = item.title || 'Resource';
    const meta = document.createElement('span');
    meta.textContent = item.kind === 'file'
      ? (item.original_name ? `File - ${item.original_name}` : 'File')
      : 'Link';
    a.append(title, meta);

    if (item.kind === 'link' && item.url) {
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (item.kind === 'file') {
      a.href = `/api/resources/${item.id}/download`;
    } else {
      a.href = '#';
      a.setAttribute('aria-disabled', 'true');
    }

    listEl.appendChild(a);
  });
}

async function loadItems() {
  const res = await apiRequest('/resources', { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load resources');
  }
  const data = await res.json();
  renderItems(Array.isArray(data.items) ? data.items : []);
}

logoutButton?.addEventListener('click', () => logout());

(async function init() {
  requireAuth();
  await checkAuth();
  try {
    await loadItems();
  } catch (error) {
    setMessage(error.message || 'Could not load resources', 'error');
    if (listEl) {
      listEl.innerHTML = '';
      const err = document.createElement('p');
      err.textContent = 'Could not load resources.';
      listEl.appendChild(err);
    }
  }
})();
