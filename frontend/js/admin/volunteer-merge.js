import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, isStaffOrAdminRole, applyRoleVisibility, logout } from '../auth.js';

// Staff merge of duplicate volunteers (SL-DAY-03). Preview first, then confirm.

const form = document.getElementById('mergeForm');
const keepSelect = document.getElementById('keepSelect');
const duplicateSelect = document.getElementById('duplicateSelect');
const previewButton = document.getElementById('previewButton');
const messageEl = document.getElementById('message');
const previewSection = document.getElementById('previewSection');
const compareBody = document.getElementById('compareBody');
const countsBody = document.getElementById('countsBody');
const confirmButton = document.getElementById('confirmButton');
const cancelButton = document.getElementById('cancelButton');
const logoutButton = document.getElementById('logoutButton');

let lastPreview = null;

function setMessage(text, tone = '') {
  messageEl.replaceChildren();
  if (!text) return;
  const p = document.createElement('p');
  if (tone) p.className = tone;
  p.textContent = text;
  messageEl.appendChild(p);
}

function displayName(v) {
  if (!v) return '-';
  const named = `${v.first_name || ''} ${v.last_name || ''}`.trim();
  return named || v.name || v.email || `User ${v.user_id}`;
}

function fillSelects(volunteers) {
  const options = volunteers
    .slice()
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }));

  for (const select of [keepSelect, duplicateSelect]) {
    const current = select.value;
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select volunteer';
    select.appendChild(blank);
    for (const v of options) {
      const opt = document.createElement('option');
      opt.value = String(v.user_id || v.id);
      opt.textContent = `${displayName(v)} (${v.email || 'no email'})`;
      select.appendChild(opt);
    }
    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  }
}

function row(label, keepText, dupText) {
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = label;
  const keep = document.createElement('td');
  keep.textContent = keepText == null || keepText === '' ? '-' : String(keepText);
  const dup = document.createElement('td');
  dup.textContent = dupText == null || dupText === '' ? '-' : String(dupText);
  tr.append(th, keep, dup);
  return tr;
}

function countRow(label, move, conflicts) {
  const tr = document.createElement('tr');
  const name = document.createElement('th');
  name.scope = 'row';
  name.textContent = label;
  const moveTd = document.createElement('td');
  moveTd.className = 'numeric-cell';
  moveTd.textContent = String(move ?? 0);
  const conflictTd = document.createElement('td');
  conflictTd.className = 'numeric-cell';
  conflictTd.textContent = conflicts == null ? '-' : String(conflicts);
  tr.append(name, moveTd, conflictTd);
  return tr;
}

function renderPreview(preview) {
  lastPreview = preview;
  const { keep, duplicate, counts } = preview;
  compareBody.replaceChildren(
    row('Name', displayName(keep), displayName(duplicate)),
    row('Email', keep.email, duplicate.email),
    row('Phone', keep.phone, duplicate.phone),
    row('Approved', keep.approved ? 'Yes' : 'No', duplicate.approved ? 'Yes' : 'No'),
    row('User id', keep.user_id, duplicate.user_id)
  );
  countsBody.replaceChildren(
    countRow('Bookings', counts.bookings.move, counts.bookings.conflicts),
    countRow('Shift notes', counts.notes.move, null),
    countRow('Qualifications', counts.qualifications.move, counts.qualifications.conflicts),
    countRow('Membership at this shelter (removed from duplicate)', counts.memberships.drop, null)
  );
  previewSection.hidden = false;
}

async function loadVolunteers() {
  const list = await apiRequest('/admin/volunteers');
  fillSelects(Array.isArray(list) ? list : []);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');
  const keepId = keepSelect.value;
  const dupId = duplicateSelect.value;
  if (!keepId || !dupId) {
    setMessage('Choose both volunteers.', 'error');
    return;
  }
  if (keepId === dupId) {
    setMessage('Keep and duplicate must be different people.', 'error');
    return;
  }
  previewButton.disabled = true;
  try {
    const preview = await apiRequest('/admin/volunteers/merge/preview', {
      method: 'POST',
      body: JSON.stringify({
        keep_user_id: Number(keepId),
        duplicate_user_id: Number(dupId),
      }),
    });
    renderPreview(preview);
    setMessage('Review the comparison, then confirm if it looks right.');
  } catch (error) {
    previewSection.hidden = true;
    lastPreview = null;
    setMessage(error.message || 'Could not preview merge.', 'error');
  } finally {
    previewButton.disabled = false;
  }
});

confirmButton.addEventListener('click', async () => {
  if (!lastPreview) return;
  const keepId = lastPreview.keep.user_id;
  const dupId = lastPreview.duplicate.user_id;
  const label = displayName(lastPreview.duplicate);
  if (!window.confirm(`Archive ${label} and move their records onto the kept volunteer? This cannot be undone from this screen.`)) {
    return;
  }
  confirmButton.disabled = true;
  try {
    const result = await apiRequest('/admin/volunteers/merge', {
      method: 'POST',
      body: JSON.stringify({
        keep_user_id: keepId,
        duplicate_user_id: dupId,
      }),
    });
    previewSection.hidden = true;
    lastPreview = null;
    setMessage(
      `Merged. Moved ${result.moved.bookings} bookings, ${result.moved.notes} notes, ${result.moved.qualifications} qualifications. Duplicate archived.`,
      'success'
    );
    await loadVolunteers();
    keepSelect.value = String(keepId);
    duplicateSelect.value = '';
  } catch (error) {
    setMessage(error.message || 'Merge failed.', 'error');
  } finally {
    confirmButton.disabled = false;
  }
});

cancelButton.addEventListener('click', () => {
  previewSection.hidden = true;
  lastPreview = null;
  setMessage('');
});

if (logoutButton) {
  logoutButton.addEventListener('click', () => logout());
}

(async function init() {
  requireAuth();
  const user = await checkAuth();
  if (!user || !isStaffOrAdminRole(user.role)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user.role);
  try {
    await loadVolunteers();
  } catch (error) {
    setMessage(error.message || 'Could not load volunteers.', 'error');
  }
})();
