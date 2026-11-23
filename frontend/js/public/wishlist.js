import { withShelterQuery } from '../shelterSlug.js';
import { escapeHtml } from '../utils/escapeHtml.js';

function priorityLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'high') return 'High priority';
  if (key === 'low') return 'Low priority';
  return 'Medium priority';
}

function renderWishlist(section, listEl, updatedEl, payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    section.hidden = true;
    listEl.replaceChildren();
    if (updatedEl) {
      updatedEl.hidden = true;
      updatedEl.textContent = '';
    }
    return;
  }

  section.hidden = false;
  if (updatedEl) {
    if (payload.updated_on) {
      updatedEl.hidden = false;
      updatedEl.textContent = `Updated on ${payload.updated_on}`;
    } else {
      updatedEl.hidden = true;
      updatedEl.textContent = '';
    }
  }

  listEl.innerHTML = items
    .map((item) => {
      const note = item.note
        ? `<p class="wishlist-note">${escapeHtml(item.note)}</p>`
        : '';
      return `<li>
        <strong>${escapeHtml(item.name)}</strong>
        <p class="wishlist-meta">
          Qty ${escapeHtml(String(item.quantity))}
          · ${escapeHtml(priorityLabel(item.priority))}
        </p>
        ${note}
      </li>`;
    })
    .join('');
}

export async function loadPublicWishlist() {
  const section = document.getElementById('publicWishlistSection');
  const listEl = document.getElementById('publicWishlistList');
  const updatedEl = document.getElementById('publicWishlistUpdatedOn');
  if (!section || !listEl) return;

  try {
    const res = await fetch(withShelterQuery('/api/public/wishlist'), {
      credentials: 'omit',
    });
    if (!res.ok) {
      section.hidden = true;
      return;
    }
    const data = await res.json();
    renderWishlist(section, listEl, updatedEl, data);
  } catch {
    section.hidden = true;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadPublicWishlist();
    });
  } else {
    loadPublicWishlist();
  }
}
