/**
 * Vanilla JS interest/opportunity tag chips.
 */

export function renderTagChips(container, tags = [], selectedIds = [], { disabled = false } = {}) {
  if (!container) return;
  const selected = new Set((selectedIds || []).map((id) => String(id)));
  container.innerHTML = '';
  container.classList.add('tag-chips');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Tags');

  if (!tags.length) {
    container.innerHTML = '<span class="tag-chips-empty">No tags available</span>';
    return;
  }

  tags.forEach((tag) => {
    const id = String(tag.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip';
    btn.dataset.tagId = id;
    btn.textContent = tag.name;
    btn.setAttribute('aria-pressed', selected.has(id) ? 'true' : 'false');
    if (selected.has(id)) btn.classList.add('is-selected');
    if (disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', on ? 'false' : 'true');
        btn.classList.toggle('is-selected', !on);
      });
    }
    container.appendChild(btn);
  });
}

export function getSelectedTagIds(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('.tag-chip[aria-pressed="true"]'))
    .map((el) => Number(el.dataset.tagId))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export function setSelectedTagIds(container, selectedIds = []) {
  if (!container) return;
  const selected = new Set((selectedIds || []).map((id) => String(id)));
  container.querySelectorAll('.tag-chip').forEach((btn) => {
    const on = selected.has(btn.dataset.tagId);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-selected', on);
  });
}
