import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';

const DEFAULT_DAYS = 2;
const MAX_DAYS = 60;

const form = document.getElementById('careGapForm');
const daysInput = document.getElementById('days');
const body = document.getElementById('careGapBody');
const summary = document.getElementById('careGapSummary');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

const ACTIVITY_LABELS = {
  walk: 'walk',
  feed: 'feed',
  socialise: 'socialise',
  clean: 'clean',
  medical: 'medical',
  transport: 'transport',
  other: 'other',
};

function daysFromSearch(search) {
  const raw = new URLSearchParams(search).get('days');
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

function setMessage(text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.replaceChildren();
    return;
  }
  const note = document.createElement('p');
  note.className = 'error';
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function formatWhen(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function gapText(row) {
  if (row.gap_days == null) return 'Unknown';
  const unit = row.gap_days === 1 ? 'day' : 'days';
  if (row.never_logged) return `${row.gap_days} ${unit}, nothing logged`;
  return `${row.gap_days} ${unit}`;
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function renderRow(row) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  const link = document.createElement('a');
  link.href = `/pages/admin/animals.html?animal=${encodeURIComponent(row.id)}`;
  link.textContent = row.name;
  nameTd.appendChild(link);
  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = [row.species, row.status].filter(Boolean).join(', ').replace(/_/g, ' ');
  nameTd.appendChild(meta);
  tr.appendChild(nameTd);

  tr.appendChild(cell(row.kennel_ref || '—'));
  tr.appendChild(cell(formatWhen(row.last_walk_at)));
  tr.appendChild(cell(formatWhen(row.last_socialise_at)));

  const lastTd = cell(formatWhen(row.last_activity_at));
  if (row.last_activity_type) {
    lastTd.textContent += ` (${ACTIVITY_LABELS[row.last_activity_type] || row.last_activity_type})`;
  }
  tr.appendChild(lastTd);

  const gapTd = document.createElement('td');
  if (row.flagged) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--pending';
    badge.textContent = `Flagged: ${gapText(row)}`;
    gapTd.appendChild(badge);
  } else {
    gapTd.textContent = gapText(row);
  }
  tr.appendChild(gapTd);

  const actionTd = document.createElement('td');
  const post = document.createElement('a');
  post.href = `/pages/admin/create-opportunity.html?animal_id=${encodeURIComponent(row.id)}`;
  post.textContent = 'Post a shift';
  actionTd.appendChild(post);
  tr.appendChild(actionTd);

  return tr;
}

async function load(days) {
  const res = await apiRequest(`/animals/care-gaps?days=${days}`);
  if (!res.ok) {
    body.replaceChildren();
    body.innerHTML = '<tr><td colspan="7">Unable to load care gaps.</td></tr>';
    return;
  }
  const data = await res.json();
  const animals = data.animals || [];
  const unit = data.flag_days === 1 ? 'day' : 'days';
  summary.textContent = animals.length
    ? `${data.flagged_count} of ${data.total} on site with no logged activity for ${data.flag_days}+ ${unit}`
    : 'Animals on site';
  body.replaceChildren();
  if (!animals.length) {
    body.innerHTML = `<tr><td colspan="7">No animals on site. Add animals on the <a href="/pages/admin/animals.html">animals page</a>.</td></tr>`;
    return;
  }
  animals.forEach((row) => body.appendChild(renderRow(row)));
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const days = daysFromSearch(`?days=${daysInput.value}`);
  daysInput.value = String(days);
  const url = new URL(window.location.href);
  url.searchParams.set('days', String(days));
  window.history.replaceState(null, '', url);
  load(days).catch((err) => setMessage(err.message || 'Failed to load.'));
});

if (logoutButton) logoutButton.addEventListener('click', () => logout());

(async () => {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user);
  const days = daysFromSearch(window.location.search);
  daysInput.value = String(days);
  await load(days);
})().catch((err) => setMessage(err.message || 'Failed to load.'));
