import { apiRequest } from '../config.js';
import { requireAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showConfirm } from '../components/confirmDialog.js';

const messageEl = document.getElementById('message');
const listEl = document.getElementById('wishlistList');
const updatedEl = document.getElementById('wishlistUpdatedOn');
const form = document.getElementById('wishlistForm');
const showArchivedEl = document.getElementById('showArchived');
const logoutButton = document.getElementById('logoutButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.dataset.tone = tone;
}

function priorityLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'high') return 'High';
  if (key === 'low') return 'Low';
  return 'Medium';
}

function renderItems(items, updatedOn) {
  if (!listEl) return;
  if (updatedEl) {
    if (updatedOn) {
      updatedEl.hidden = false;
      updatedEl.textContent = `Updated on ${updatedOn}`;
    } else {
      updatedEl.hidden = true;
      updatedEl.textContent = '';
    }
  }
  if (!items.length) {
    listEl.innerHTML = '<p class="wishlist-empty">No wishlist items yet.</p>';
    return;
  }

  listEl.innerHTML = `<ul class="wishlist-ruled-list">${items
    .map((item) => {
      const archived = Boolean(item.archived_at);
      const note = item.note
        ? `<p class="wishlist-note">${escapeHtml(item.note)}</p>`
        : '';
      return `<li data-id="${item.id}">
        <div class="wishlist-ruled-main">
          <strong>${escapeHtml(item.name)}</strong>
          <p class="wishlist-meta">
            Qty ${escapeHtml(String(item.quantity))}
            · ${escapeHtml(priorityLabel(item.priority))}
            ${archived ? ' · Archived' : ''}
          </p>
          ${note}
        </div>
        <div class="wishlist-ruled-actions">
          ${
            archived
              ? ''
              : `<button type="button" class="secondary" data-action="archive">Remove from list</button>`
          }
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

async function loadList() {
  const showArchived = Boolean(showArchivedEl?.checked);
  const query = showArchived ? '?all=1' : '';
  const res = await apiRequest(`/wishlist${query}`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load wishlist');
  }
  const data = await res.json();
  renderItems(Array.isArray(data.items) ? data.items : [], data.updated_on || null);
}

async function onSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('wishlist_name')?.value?.trim() || '';
  const quantityRaw = document.getElementById('wishlist_quantity')?.value;
  const priority = document.getElementById('wishlist_priority')?.value || 'medium';
  const note = document.getElementById('wishlist_note')?.value?.trim() || '';
  const quantity = Number(quantityRaw);

  const payload = { name, quantity, priority };
  if (note) payload.note = note;

  const res = await apiRequest('/wishlist', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not add item', 'error');
    return;
  }
  form?.reset();
  const qty = document.getElementById('wishlist_quantity');
  if (qty) qty.value = '1';
  const pri = document.getElementById('wishlist_priority');
  if (pri) pri.value = 'medium';
  setMessage('Item added to the public wishlist.', 'success');
  await loadList();
}

async function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !listEl?.contains(button)) return;
  const row = button.closest('li[data-id]');
  const id = row?.dataset?.id;
  if (!id) return;

  if (button.dataset.action === 'archive') {
    const ok = await showConfirm({
      title: 'Remove this item?',
      body: 'It will leave the public wishlist. You can still see it under Show archived.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    const res = await apiRequest(`/wishlist/${id}/archive`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err.error || 'Could not archive item', 'error');
      return;
    }
    setMessage('Item removed from the public list.', 'success');
    await loadList();
  }
}

async function start() {
  const session = await requireAuth();
  if (!isStaffOrAdminRole(session?.role)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  logoutButton?.addEventListener('click', () => logout());
  form?.addEventListener('submit', onSubmit);
  showArchivedEl?.addEventListener('change', () => {
    loadList().catch((err) => setMessage(err.message, 'error'));
  });
  listEl?.addEventListener('click', (event) => {
    onListClick(event).catch((err) => setMessage(err.message, 'error'));
  });
  try {
    await loadList();
  } catch (err) {
    setMessage(err.message || 'Could not load wishlist', 'error');
  }
}

start();
