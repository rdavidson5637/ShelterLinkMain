import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';

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

function appendApplicationRow(app, options = {}) {
  const tr = document.createElement('tr');
  if (options.groupClass) tr.className = options.groupClass;

  const nameTd = document.createElement('td');
  nameTd.textContent = volunteerName(app);

  const emailTd = document.createElement('td');
  emailTd.textContent = app.email || 'N/A';

  const titleTd = document.createElement('td');
  titleTd.textContent = app.opportunity_title || 'Opportunity';

  const dateTd = document.createElement('td');
  dateTd.textContent = app.created_at || app.applied_at || '';

  const statusTd = document.createElement('td');
  if (app.status === 'waitlisted' && options.position) {
    statusTd.textContent = `waitlisted (#${options.position})`;
  } else {
    statusTd.textContent = app.status || '';
  }

  const actionsTd = document.createElement('td');
  actionsTd.style.display = 'flex';
  actionsTd.style.gap = '0.4rem';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.textContent = app.status === 'waitlisted' ? 'Accept from waitlist' : 'Approve';
  approveBtn.classList.add('contrast', 'button-small');
  approveBtn.addEventListener('click', () => handleStatusChange(app.id, 'accepted'));

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.textContent = 'Reject';
  rejectBtn.classList.add('secondary', 'button-secondary', 'button-small');
  rejectBtn.addEventListener('click', () => openModal(app.id));

  actionsTd.appendChild(approveBtn);
  actionsTd.appendChild(rejectBtn);

  const isAccepted = app.status === 'accepted' || app.status === 'approved';
  const startRaw = app.opportunity_start_date || app.opportunity_end_date;
  const startDate = startRaw ? new Date(startRaw) : null;
  const isPast =
    startDate &&
    !Number.isNaN(startDate.getTime()) &&
    startDate.getTime() < Date.now() - 24 * 60 * 60 * 1000;
  if (isAccepted && isPast && !Number(app.no_show)) {
    const noShowBtn = document.createElement('button');
    noShowBtn.type = 'button';
    noShowBtn.textContent = 'Mark no-show';
    noShowBtn.classList.add('secondary', 'button-secondary', 'button-small');
    noShowBtn.addEventListener('click', () => markNoShow(app.id));
    actionsTd.appendChild(noShowBtn);
  } else if (Number(app.no_show)) {
    const flagged = document.createElement('span');
    flagged.textContent = 'No-show';
    flagged.style.cssText = 'color:#c62828;font-size:0.85rem;align-self:center;';
    actionsTd.appendChild(flagged);
  }

  tr.appendChild(nameTd);
  tr.appendChild(emailTd);
  tr.appendChild(titleTd);
  tr.appendChild(dateTd);
  tr.appendChild(statusTd);
  tr.appendChild(actionsTd);

  tableBody.appendChild(tr);
}

function renderRows() {
  if (!tableBody) return;
  tableBody.innerHTML = '';

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
    th.colSpan = 6;
    th.innerHTML = '<strong>Waitlisted applicants</strong> (oldest first)';
    th.style.background = '#e3f2fd';
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
