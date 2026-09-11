import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { createOverflowMenu, createIdentityCell } from '../components/overflowMenu.js';

const statusFilter = document.getElementById('statusFilter');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');
const notesModal = document.getElementById('notesModal');
const rejectNotesInput = document.getElementById('rejectNotes');
const cancelModalButton = document.getElementById('cancelModalButton');
const submitModalButton = document.getElementById('submitModalButton');

let applications = [];
let pendingRejectId = null;
let tableBody;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function closeModal() {
  pendingRejectId = null;
  if (rejectNotesInput) rejectNotesInput.value = '';
  if (notesModal && typeof notesModal.close === 'function') {
    notesModal.close();
  }
}

function openModal(applicationId) {
  pendingRejectId = applicationId;
  if (notesModal && typeof notesModal.showModal === 'function') {
    notesModal.showModal();
  }
}

function volunteerName(app) {
  return `${app.first_name || ''} ${app.last_name || ''}`.trim() || app.name || 'N/A';
}

function waitlistPositionWithinOpportunity(app, peers) {
  const ordered = peers
    .filter((a) => a.status === 'waitlisted' && a.opportunity_id === app.opportunity_id)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.applied_at || a.created_at || 0).getTime();
      const tb = new Date(b.applied_at || b.created_at || 0).getTime();
      if (ta !== tb) return ta - tb;
      return Number(a.application_id || a.id) - Number(b.application_id || b.id);
    });
  const idx = ordered.findIndex(
    (a) => String(a.application_id || a.id) === String(app.application_id || app.id)
  );
  return idx >= 0 ? idx + 1 : null;
}

function buildApplicationActions(app, isAccepted, isPast) {
  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.textContent = app.status === 'waitlisted' ? 'Accept from waitlist' : 'Approve';
  approveBtn.classList.add('contrast', 'button-small');
  approveBtn.addEventListener('click', () => handleStatusChange(app.id, 'accepted'));
  actions.appendChild(approveBtn);

  const menuItems = [{ label: 'Reject', destructive: true, onSelect: () => openModal(app.id) }];
  if (isAccepted && isPast && !Number(app.no_show)) {
    menuItems.unshift({ label: 'Mark no-show', onSelect: () => markNoShow(app.id) });
  }
  actions.appendChild(createOverflowMenu({ items: menuItems }));
  if (Number(app.no_show)) {
    actions.appendChild(createStatusBadge('no-show'));
  }
  return actions;
}

function appendApplicationRow(app, options = {}) {
  const tr = document.createElement('tr');
  if (options.groupClass) tr.className = options.groupClass;

  const suffix =
    app.status === 'waitlisted' && options.position ? ` (#${options.position})` : '';
  const isAccepted = app.status === 'accepted' || app.status === 'approved';
  const startRaw = app.opportunity_start_date || app.opportunity_end_date;
  const startDate = startRaw ? new Date(startRaw) : null;
  const isPast =
    startDate &&
    !Number.isNaN(startDate.getTime()) &&
    startDate.getTime() < Date.now() - 24 * 60 * 60 * 1000;

  const titleTd = document.createElement('td');
  titleTd.textContent = app.opportunity_title || 'Opportunity';

  const dateTd = document.createElement('td');
  dateTd.textContent = formatDateOnly(app.created_at || app.applied_at) || 'N/A';

  const statusTd = document.createElement('td');
  statusTd.appendChild(createStatusBadge(app.status, { suffix }));

  const actionsTd = document.createElement('td');
  actionsTd.appendChild(buildApplicationActions(app, isAccepted, isPast));

  tr.append(
    createIdentityCell(volunteerName(app), app.email || ''),
    titleTd,
    dateTd,
    statusTd,
    actionsTd
  );
  tableBody.appendChild(tr);

  const cardList = document.getElementById('applicationsCardList');
  if (cardList) {
    const card = document.createElement('article');
    card.className = 'person-card';
    if (options.groupClass) card.classList.add(options.groupClass);
    const name = document.createElement('strong');
    name.textContent = volunteerName(app);
    const email = document.createElement('small');
    email.textContent = app.email || '';
    const meta = document.createElement('p');
    meta.className = 'person-card-meta';
    meta.textContent = `${app.opportunity_title || 'Opportunity'} · ${formatDateOnly(app.created_at || app.applied_at) || ''}`;
    card.append(
      name,
      email,
      createStatusBadge(app.status, { suffix }),
      meta,
      buildApplicationActions(app, isAccepted, isPast)
    );
    cardList.appendChild(card);
  }
}

function renderRows() {
  if (!tableBody) return;
  tableBody.innerHTML = '';
  const cardList = document.getElementById('applicationsCardList');
  if (cardList) cardList.innerHTML = '';

  if (!applications.length) {
    setMessage('No applications found for this filter.');
    return;
  }
  setMessage('');

  const waitlisted = applications
    .filter((app) => app.status === 'waitlisted')
    .slice()
    .sort((a, b) => {
      const oppCmp = String(a.opportunity_title || '').localeCompare(String(b.opportunity_title || ''));
      if (oppCmp !== 0) return oppCmp;
      const ta = new Date(a.applied_at || a.created_at || 0).getTime();
      const tb = new Date(b.applied_at || b.created_at || 0).getTime();
      if (ta !== tb) return ta - tb;
      return Number(a.application_id || a.id) - Number(b.application_id || b.id);
    });
  const others = applications.filter((app) => app.status !== 'waitlisted');

  if (waitlisted.length) {
    const header = document.createElement('tr');
    const th = document.createElement('td');
    th.colSpan = 5;
    th.className = 'waitlist-group-heading';
    th.innerHTML = '<strong>Waitlisted applicants</strong> (oldest first)';
    header.appendChild(th);
    tableBody.appendChild(header);

    waitlisted.forEach((app) => {
      appendApplicationRow(app, {
        groupClass: 'waitlisted-row',
        position: waitlistPositionWithinOpportunity(app, waitlisted),
      });
    });
  }

  others.forEach((app) => appendApplicationRow(app));
}

async function fetchApplications() {
  const status = statusFilter?.value === 'all' ? '' : statusFilter?.value || 'pending';
  setMessage('Loading applications...');
  try {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await apiRequest(`/applications${query}`, { method: 'GET' });
    if (!res.ok) {
      setMessage('Failed to load applications.', 'error');
      applications = [];
      if (tableBody) tableBody.innerHTML = '';
      const cardList = document.getElementById('applicationsCardList');
      if (cardList) cardList.innerHTML = '';
      return;
    }
    applications = await res.json();
    renderRows();
  } catch (error) {
    console.error('[Admin] fetchApplications error:', error);
    setMessage('Network error while loading applications.', 'error');
  }
}

async function handleStatusChange(applicationId, status, notes = null) {
  try {
    const res = await apiRequest(`/applications/${applicationId}`, {
      method: 'PUT',
      body: { status, notes },
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      setMessage(errorBody?.error || 'Failed to update application.', 'error');
      return;
    }

    setMessage(`Application ${status}.`, 'success');
    await fetchApplications();
  } catch (error) {
    console.error('[Admin] handleStatusChange error:', error);
    setMessage('Network error while updating application.', 'error');
  }
}

async function markNoShow(applicationId) {
  const confirmed = window.confirm('Mark this volunteer as a no-show for this past shift?');
  if (!confirmed) return;
  try {
    const res = await apiRequest(`/applications/${applicationId}/no-show`, {
      method: 'PATCH',
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      setMessage(errorBody?.error || 'Failed to mark no-show.', 'error');
      return;
    }
    setMessage('Marked as no-show.', 'success');
    await fetchApplications();
  } catch (error) {
    console.error('[Admin] markNoShow error:', error);
    setMessage('Network error while marking no-show.', 'error');
  }
}

function attachEventListeners() {
  if (statusFilter) {
    statusFilter.addEventListener('change', fetchApplications);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  if (cancelModalButton) {
    cancelModalButton.addEventListener('click', () => {
      closeModal();
    });
  }

  if (submitModalButton) {
    submitModalButton.addEventListener('click', async () => {
      if (!pendingRejectId) {
        closeModal();
        return;
      }
      const notes = rejectNotesInput?.value || null;
      await handleStatusChange(pendingRejectId, 'rejected', notes);
      closeModal();
    });
  }
}

async function enforceAdmin() {
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return null;
  }
  applyRoleVisibility(user);
  return user;
}

async function init() {
  tableBody = document.getElementById('applicationsTableBody');
  await requireAuth();
  await enforceAdmin();
  attachEventListeners();
  await fetchApplications();
}

document.addEventListener('DOMContentLoaded', init);
