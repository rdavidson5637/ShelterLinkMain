import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const overallAverageEl = document.getElementById('overallAverage');
const overallCountEl = document.getElementById('overallCount');
const byOpportunityList = document.getElementById('byOpportunityList');
const tableBody = document.getElementById('feedbackTableBody');
const filtersForm = document.getElementById('filtersForm');
const filterOpportunityId = document.getElementById('filterOpportunityId');
const filterMinRating = document.getElementById('filterMinRating');
const filterFlagConcern = document.getElementById('filterFlagConcern');
const filterHandled = document.getElementById('filterHandled');
const clearFiltersButton = document.getElementById('clearFiltersButton');
const logoutButton = document.getElementById('logoutButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function formatDate(value) {
  return formatDateOnly(value) || '—';
}

function buildQuery() {
  const params = new URLSearchParams();
  if (filterOpportunityId?.value) params.set('opportunityId', filterOpportunityId.value);
  if (filterMinRating?.value) params.set('minRating', filterMinRating.value);
  if (filterFlagConcern?.value) params.set('flagConcern', filterFlagConcern.value);
  if (filterHandled?.value) params.set('handled', filterHandled.value);
  const q = params.toString();
  return q ? `?${q}` : '';
}

function renderAverages(averages) {
  if (overallAverageEl) {
    overallAverageEl.textContent =
      averages?.overall != null ? Number(averages.overall).toFixed(2) : '—';
  }
  if (overallCountEl) {
    overallCountEl.textContent = `${averages?.count || 0} rating${averages?.count === 1 ? '' : 's'}`;
  }
  if (!byOpportunityList) return;
  const rows = averages?.byOpportunity || [];
  if (!rows.length) {
    byOpportunityList.innerHTML = '<li>No ratings yet</li>';
    return;
  }
  byOpportunityList.innerHTML = rows
    .map(
      (r) =>
        `<li><span>${r.opportunity_title}</span><strong>${Number(r.average).toFixed(2)} (${r.count})</strong></li>`
    )
    .join('');
}

function renderTable(items) {
  if (!tableBody) return;
  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="7">No feedback matching filters</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  items.forEach((item) => {
    const tr = document.createElement('tr');
    const openConcern = item.flag_concern && !item.handled_at;
    if (openConcern) tr.classList.add('concern-open');

    const concernLabel = !item.flag_concern
      ? '—'
      : item.handled_at
        ? 'Handled'
        : 'Needs attention';

    tr.innerHTML = `
      <td>${formatDate(item.created_at)}</td>
      <td>${item.volunteer_name || item.volunteer_email || '—'}</td>
      <td>${item.opportunity_title || `#${item.opportunity_id}`}</td>
      <td>${item.rating}/5</td>
      <td>${item.comment ? String(item.comment) : '—'}</td>
      <td>${concernLabel}</td>
      <td></td>
    `;

    const actionsTd = tr.lastElementChild;
    if (openConcern) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = 'Mark handled';
      btn.addEventListener('click', () => markHandled(item.id, btn));
      actionsTd.appendChild(btn);
    } else {
      actionsTd.textContent = '—';
    }

    tableBody.appendChild(tr);
  });
}

async function markHandled(id, button) {
  if (button) button.disabled = true;
  try {
    const res = await apiRequest(`/feedback/admin/${id}/handled`, { method: 'PATCH' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error || 'Unable to mark handled.', 'error');
      if (button) button.disabled = false;
      return;
    }
    setMessage('Concern marked as handled.', 'success');
    await loadFeedback();
  } catch (error) {
    console.error('[AdminFeedback] markHandled error:', error);
    setMessage('Network error.', 'error');
    if (button) button.disabled = false;
  }
}

async function loadFeedback() {
  try {
    const res = await apiRequest(`/feedback/admin${buildQuery()}`, { method: 'GET' });
    if (!res.ok) {
      tableBody.innerHTML = '<tr><td colspan="7">Failed to load feedback</td></tr>';
      setMessage('Unable to load feedback.', 'error');
      return;
    }
    const data = await res.json();
    renderAverages(data.averages || {});
    renderTable(Array.isArray(data.items) ? data.items : []);
  } catch (error) {
    console.error('[AdminFeedback] loadFeedback error:', error);
    tableBody.innerHTML = '<tr><td colspan="7">Error loading feedback</td></tr>';
  }
}

function attachListeners() {
  filtersForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadFeedback();
  });

  clearFiltersButton?.addEventListener('click', () => {
    if (filterOpportunityId) filterOpportunityId.value = '';
    if (filterMinRating) filterMinRating.value = '';
    if (filterFlagConcern) filterFlagConcern.value = '';
    if (filterHandled) filterHandled.value = '';
    loadFeedback();
  });

  logoutButton?.addEventListener('click', () => logout());
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/error/403.html';
    return;
  }
  applyRoleVisibility(user);
  attachListeners();
  await loadFeedback();
}

document.addEventListener('DOMContentLoaded', init);
