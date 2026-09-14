import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { showToast } from '../utils/errorHandler.js';
import { renderTagChips, getSelectedTagIds, setSelectedTagIds } from '../components/tagChips.js';
import { formatShiftWhen, splitDateTime, combineDateTime } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';

const tableBody = document.getElementById('opportunitiesTableBody');
const statusFilter = document.getElementById('statusFilter');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');
const editForm = document.getElementById('editOpportunityForm');
const saveButton = document.getElementById('saveButton');
const cancelEditButton = document.getElementById('cancelEditButton');

const idInput = document.getElementById('opportunity_id');
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const locationInput = document.getElementById('location');
const startDateInput = document.getElementById('start_date');
const startTimeInput = document.getElementById('start_time');
const endDateInput = document.getElementById('end_date');
const endTimeInput = document.getElementById('end_time');
const maxVolunteersInput = document.getElementById('max_volunteers');
const cancellationCutoffInput = document.getElementById('cancellation_cutoff_hours');
const activityNotesInput = document.getElementById('activity_notes');
const requirementsInput = document.getElementById('requirements');
const qualificationSelect = document.getElementById('qualification_ids');
const opportunityTagsEl = document.getElementById('opportunityTags');
const shiftNotesSection = document.getElementById('shiftNotesSection');
const shiftNotesList = document.getElementById('shiftNotesList');
const shiftNoteBody = document.getElementById('shiftNoteBody');
const shiftNoteNotify = document.getElementById('shiftNoteNotify');
const addShiftNoteButton = document.getElementById('addShiftNoteButton');

let opportunities = [];
let selectedOpportunityId = null;
let allQualifications = [];
let allTags = [];
let currentUserRole = null;

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cssClass = type === 'error' ? 'error-message' : 'success-message';
  messageEl.innerHTML = `<p class="${cssClass}">${text}</p>`;
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function formatDateRange(opportunity) {
  return formatShiftWhen(opportunity.start_date, opportunity.end_date);
}

function clearEditForm() {
  selectedOpportunityId = null;
  if (editForm) editForm.reset();
  if (idInput) idInput.value = '';
  if (qualificationSelect) {
    Array.from(qualificationSelect.options).forEach((o) => {
      o.selected = false;
    });
  }
  setSelectedTagIds(opportunityTagsEl, []);
  if (saveButton) saveButton.disabled = true;
  if (shiftNotesSection) shiftNotesSection.hidden = true;
  if (shiftNotesList) shiftNotesList.innerHTML = '';
  if (shiftNoteBody) shiftNoteBody.value = '';
  if (shiftNoteNotify) shiftNoteNotify.checked = false;
}

function setDateConstraint() {
  if (!startDateInput || !endDateInput) return;
  endDateInput.min = startDateInput.value || '';
}

function validateFormDates() {
  if (!startDateInput || !endDateInput) return true;
  if (!startDateInput.value || !endDateInput.value) return true;
  const start = new Date(startDateInput.value);
  const end = new Date(endDateInput.value);
  if (end < start) {
    setMessage('error', 'End date must be on or after start date.');
    return false;
  }
  // Same-day shifts also need their times compared — a same-day end time
  // before the start time (e.g. start 12:00, end 09:00) passes the
  // date-only check above but is still a shift that runs backwards.
  const startAt = new Date(combineDateTime(startDateInput.value, startTimeInput?.value));
  const endAt = new Date(combineDateTime(endDateInput.value, endTimeInput?.value));
  if (endAt < startAt) {
    setMessage('error', 'End must be on or after start.');
    return false;
  }
  return true;
}

function populateEditForm(opportunity) {
  selectedOpportunityId = opportunity.id;
  if (idInput) idInput.value = String(opportunity.id);
  if (titleInput) titleInput.value = opportunity.title || '';
  if (descriptionInput) descriptionInput.value = opportunity.description || '';
  if (locationInput) locationInput.value = opportunity.location || '';
  // Split into separate date/time inputs — truncating to slice(0, 10) alone
  // (the old behavior) discards the time entirely, so saving the form again
  // without touching dates would silently reset the shift to midnight.
  const start = splitDateTime(opportunity.start_date);
  const end = splitDateTime(opportunity.end_date);
  if (startDateInput) startDateInput.value = start.date;
  if (startTimeInput) startTimeInput.value = start.time;
  if (endDateInput) endDateInput.value = end.date;
  if (endTimeInput) endTimeInput.value = end.time;
  if (maxVolunteersInput) {
    maxVolunteersInput.value =
      opportunity.max_volunteers === null || opportunity.max_volunteers === undefined
        ? ''
        : String(opportunity.max_volunteers);
  }
  if (cancellationCutoffInput) {
    cancellationCutoffInput.value =
      opportunity.cancellation_cutoff_hours == null
        ? '24'
        : String(opportunity.cancellation_cutoff_hours);
  }
  if (activityNotesInput) {
    activityNotesInput.value = opportunity.activity_notes || '';
  }
  if (requirementsInput) requirementsInput.value = opportunity.requirements || '';
  if (qualificationSelect) {
    const requiredIds = new Set(
      (opportunity.required_qualifications || []).map((q) => String(q.id))
    );
    Array.from(qualificationSelect.options).forEach((o) => {
      o.selected = requiredIds.has(o.value);
    });
  }
  setSelectedTagIds(
    opportunityTagsEl,
    (opportunity.tags || []).map((t) => t.id)
  );
  setDateConstraint();
  if (saveButton) saveButton.disabled = false;
  editForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadShiftNotes(opportunity.id, opportunity.shift_notes);
}

function formatNoteWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderShiftNotes(notes = []) {
  if (!shiftNotesList) return;
  if (!notes.length) {
    shiftNotesList.innerHTML = '<p><small>No shift notes yet.</small></p>';
    return;
  }
  shiftNotesList.innerHTML = notes
    .map((n) => {
      const when = formatNoteWhen(n.created_at);
      const canDelete = currentUserRole === 'admin';
      return `<article style="margin:0.5rem 0;padding:0.5rem 0.75rem;border-left:3px solid #1b5e20;background:#f6f7f6;">
        <p style="margin:0;"><strong>${n.author_name || 'Staff'}</strong>${
          when ? ` · ${when}` : ''
        }</p>
        <p style="margin:0.25rem 0;">${n.body || ''}</p>
        ${
          canDelete
            ? `<button type="button" class="secondary button-small" data-delete-note="${n.id}">Delete</button>`
            : ''
        }
      </article>`;
    })
    .join('');

  shiftNotesList.querySelectorAll('[data-delete-note]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const noteId = btn.getAttribute('data-delete-note');
      deleteShiftNote(noteId);
    });
  });
}

async function loadShiftNotes(opportunityId, preloaded = null) {
  if (!shiftNotesSection || !opportunityId) return;
  shiftNotesSection.hidden = false;
  if (Array.isArray(preloaded)) {
    renderShiftNotes(preloaded);
    return;
  }
  try {
    const res = await apiRequest(`/opportunities/${opportunityId}/notes`);
    if (!res.ok) {
      renderShiftNotes([]);
      return;
    }
    renderShiftNotes(await res.json());
  } catch (error) {
    console.error('[Admin] loadShiftNotes error:', error);
    renderShiftNotes([]);
  }
}

async function addShiftNote() {
  if (!selectedOpportunityId) return;
  const body = (shiftNoteBody?.value || '').trim();
  if (!body) {
    setMessage('error', 'Enter a note before adding.');
    return;
  }
  try {
    const res = await apiRequest(`/opportunities/${selectedOpportunityId}/notes`, {
      method: 'POST',
      body: {
        body,
        notify: Boolean(shiftNoteNotify?.checked),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Failed to add note');
      return;
    }
    if (shiftNoteBody) shiftNoteBody.value = '';
    if (shiftNoteNotify) shiftNoteNotify.checked = false;
    setMessage('success', 'Shift note added.');
    await loadShiftNotes(selectedOpportunityId);
  } catch (error) {
    console.error('[Admin] addShiftNote error:', error);
    setMessage('error', 'Failed to add note');
  }
}

async function deleteShiftNote(noteId) {
  if (!selectedOpportunityId || !noteId) return;
  if (!window.confirm('Delete this shift note?')) return;
  try {
    const res = await apiRequest(
      `/opportunities/${selectedOpportunityId}/notes/${noteId}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Failed to delete note');
      return;
    }
    setMessage('success', 'Note deleted.');
    await loadShiftNotes(selectedOpportunityId);
  } catch (error) {
    console.error('[Admin] deleteShiftNote error:', error);
    setMessage('error', 'Failed to delete note');
  }
}

function getFilteredOpportunities() {
  const selectedStatus = statusFilter?.value || '';
  if (!selectedStatus) return opportunities;
  return opportunities.filter((opportunity) => opportunity.status === selectedStatus);
}

function isSeriesMember(opportunity) {
  return (
    (opportunity.recurrence_rule && opportunity.recurrence_rule !== 'none') ||
    Boolean(opportunity.parent_opportunity_id)
  );
}

function createRepeatIndicator(opportunity) {
  if (!isSeriesMember(opportunity)) return '';
  const rule = opportunity.recurrence_rule && opportunity.recurrence_rule !== 'none'
    ? opportunity.recurrence_rule
    : 'series';
  const label = rule === 'daily' ? 'Repeats daily' : rule === 'weekly' ? 'Repeats weekly' : 'Part of series';
  return ` <span class="repeat-indicator" title="${label}" aria-label="${label}">↻</span>`;
}

function createCheckInCodeBadge(opportunity) {
  if (!opportunity.check_in_code) return '';
  return ` <code title="Check-in code" style="font-size:0.85em;">${opportunity.check_in_code}</code>`;
}

function createUrgentBadge(opportunity) {
  if (!Number(opportunity.is_urgent)) return '';
  return ' <span class="status-badge" style="background:#fde8e8;color:#7a1f1f;">Urgent</span>';
}

function renderOpportunitiesTable() {
  if (!tableBody) return;
  const filtered = getFilteredOpportunities();

  if (!filtered.length) {
    tableBody.innerHTML = `<tr><td colspan="5">
      <div class="empty-state">
        <p>No opportunities found.</p>
        <a href="/pages/admin/create-opportunity.html" role="button" class="outline">Create a shift</a>
      </div>
    </td></tr>`;
    return;
  }

  tableBody.innerHTML = '';

  filtered.forEach((opportunity) => {
    const tr = document.createElement('tr');

    const titleTd = document.createElement('td');
    titleTd.innerHTML = `${opportunity.title || 'Untitled'}${createUrgentBadge(opportunity)}${createRepeatIndicator(opportunity)}${createCheckInCodeBadge(opportunity)}`;

    const locationTd = document.createElement('td');
    locationTd.textContent = opportunity.location || 'N/A';

    const datesTd = document.createElement('td');
    datesTd.textContent = formatDateRange(opportunity);

    const statusTd = document.createElement('td');
    statusTd.appendChild(createStatusBadge(opportunity.status));

    const actionsTd = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'opportunity-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'secondary button-secondary button-small';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => {
      setMessage();
      populateEditForm(opportunity);
    });

    actionsWrap.appendChild(editButton);

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'secondary button-secondary button-small';
    duplicateButton.textContent = 'Duplicate';
    duplicateButton.addEventListener('click', () => {
      duplicateOpportunity(opportunity);
    });
    actionsWrap.appendChild(duplicateButton);

    if (
      opportunity.status === 'open' &&
      !Number(opportunity.is_urgent)
    ) {
      const urgentButton = document.createElement('button');
      urgentButton.type = 'button';
      urgentButton.className = 'button-small';
      urgentButton.textContent = 'Urgent cover';
      urgentButton.addEventListener('click', () => {
        flagUrgentCover(opportunity);
      });
      actionsWrap.appendChild(urgentButton);
    }

    if (opportunity.status !== 'closed') {
      const chatButton = document.createElement('button');
      chatButton.type = 'button';
      chatButton.className = 'secondary button-secondary button-small';
      chatButton.textContent = 'Open shift chat';
      chatButton.addEventListener('click', async () => {
        try {
          const { openShiftChat, messagesPageHref } = await import('../components/threadsUi.js');
          const thread = await openShiftChat(opportunity.id, {
            subject: opportunity.title || `Shift chat #${opportunity.id}`,
          });
          window.location.href = messagesPageHref(thread.id, { admin: true });
        } catch (error) {
          setMessage('error', error.message || 'Could not open shift chat');
        }
      });
      actionsWrap.appendChild(chatButton);
    }

    if (opportunity.status !== 'closed') {
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'button-small';
      closeButton.textContent = 'Close';
      closeButton.addEventListener('click', () => {
        closeOpportunity(opportunity);
      });
      actionsWrap.appendChild(closeButton);
    }

    if (opportunity.check_in_code) {
      const printButton = document.createElement('button');
      printButton.type = 'button';
      printButton.className = 'secondary button-secondary button-small';
      printButton.textContent = 'Print code';
      printButton.addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html><head><title>Check-in code</title>
          <style>body{font-family:system-ui,sans-serif;text-align:center;padding:3rem}
          h1{font-size:1.25rem}code{font-size:3rem;letter-spacing:0.2em}</style></head><body>
          <h1>${opportunity.title || 'Shift'}</h1>
          <p>${formatDateRange(opportunity)}</p>
          <p>Check-in code</p>
          <code>${opportunity.check_in_code}</code>
          <script>window.print()<\/script>
          </body></html>`);
        w.document.close();
      });
      actionsWrap.appendChild(printButton);
    }

    actionsTd.appendChild(actionsWrap);

    tr.appendChild(titleTd);
    tr.appendChild(locationTd);
    tr.appendChild(datesTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionsTd);

    tableBody.appendChild(tr);
  });
}

async function fetchOpportunities() {
  try {
    const params = new URLSearchParams();
    if (statusFilter?.value) {
      params.set('status', statusFilter.value);
    }
    const query = params.toString();
    const endpoint = query ? `/opportunities?${query}` : '/opportunities';
    const response = await apiRequest(endpoint, { method: 'GET' });
    if (!response.ok) {
      setMessage('error', 'Failed to load opportunities.');
      opportunities = [];
      renderOpportunitiesTable();
      return;
    }
    const data = await response.json();
    opportunities = Array.isArray(data) ? data : [];
    renderOpportunitiesTable();
  } catch (error) {
    console.error('[Admin] fetch opportunities error:', error);
    setMessage('error', 'Network error while loading opportunities.');
    opportunities = [];
    renderOpportunitiesTable();
  }
}

function buildUpdatePayload() {
  const selectedQuals = qualificationSelect
    ? Array.from(qualificationSelect.selectedOptions).map((o) => Number(o.value)).filter(Boolean)
    : [];
  return {
    title: titleInput?.value?.trim(),
    description: descriptionInput?.value?.trim(),
    location: locationInput?.value?.trim(),
    start_date: combineDateTime(startDateInput?.value, startTimeInput?.value),
    end_date: combineDateTime(endDateInput?.value, endTimeInput?.value),
    requirements: requirementsInput?.value?.trim(),
    max_volunteers: maxVolunteersInput?.value ? Number(maxVolunteersInput.value) : null,
    cancellation_cutoff_hours: cancellationCutoffInput?.value
      ? Number(cancellationCutoffInput.value)
      : 24,
    qualification_ids: selectedQuals,
    tag_ids: getSelectedTagIds(opportunityTagsEl),
  };
}

async function saveOpportunity(event) {
  event.preventDefault();
  setMessage();

  if (!selectedOpportunityId) {
    setMessage('error', 'Select an opportunity to edit first.');
    return;
  }

  if (!validateFormDates()) {
    return;
  }

  const payload = buildUpdatePayload();
  saveButton?.setAttribute('disabled', 'true');

  try {
    const response = await apiRequest(`/opportunities/${selectedOpportunityId}`, {
      method: 'PUT',
      body: payload,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage('error', errorBody?.error || 'Failed to update opportunity.');
      return;
    }

    setMessage('success', 'Opportunity updated.');
    await fetchOpportunities();
  } catch (error) {
    console.error('[Admin] update opportunity error:', error);
    setMessage('error', 'Network error while updating opportunity.');
  } finally {
    if (selectedOpportunityId) {
      saveButton?.removeAttribute('disabled');
    }
  }
}

async function duplicateOpportunity(opportunity) {
  const confirmed = window.confirm(
    `Duplicate "${opportunity.title}"? A new draft will be created with dates cleared — set the dates and save.`
  );
  if (!confirmed) return;

  try {
    const response = await apiRequest(`/opportunities/${opportunity.id}/clone`, {
      method: 'POST',
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage('error', errorBody?.error || 'Failed to duplicate opportunity.');
      return;
    }
    const clone = await response.json();
    setMessage('success', 'Draft created — set the dates below and save.');
    await fetchOpportunities();
    const refreshed = opportunities.find((o) => Number(o.id) === Number(clone.id));
    populateEditForm(refreshed || clone);
  } catch (error) {
    console.error('[Admin] duplicate opportunity error:', error);
    setMessage('error', 'Network error while duplicating opportunity.');
  }
}

async function flagUrgentCover(opportunity) {
  const confirmed = window.confirm(
    `Broadcast urgent cover for "${opportunity.title}"?\n\nQualified approved volunteers who have not applied will get one email. You can only do this once per 24 hours.`
  );
  if (!confirmed) return;

  try {
    setMessage('success', 'Sending urgent cover…');
    const response = await apiRequest(`/opportunities/${opportunity.id}/urgent`, {
      method: 'POST',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = body?.error || 'Failed to flag urgent cover.';
      setMessage('error', msg);
      return;
    }
    const msg = `Urgent cover sent to ${body.sent ?? 0} volunteer${Number(body.sent) === 1 ? '' : 's'}.`;
    setMessage('success', msg);
    showToast(msg, 'success');
    await fetchOpportunities();
  } catch (error) {
    console.error('[Admin] urgent cover error:', error);
    setMessage('error', 'Network error while flagging urgent cover.');
  }
}

async function closeOpportunity(opportunity) {
  const partOfSeries = isSeriesMember(opportunity);
  let deleteSeries = false;

  if (partOfSeries) {
    deleteSeries = window.confirm(
      `"${opportunity.title}" is part of a repeating series.\n\nOK = delete the whole series (skips shifts with accepted applications)\nCancel = close only this shift`
    );
    if (!deleteSeries) {
      const closeOnly = window.confirm(`Close only "${opportunity.title}"? This will hide it from volunteers.`);
      if (!closeOnly) return;
    }
  } else {
    const confirmed = window.confirm(`Close "${opportunity.title}"? This will hide it from volunteers.`);
    if (!confirmed) return;
  }

  try {
    const endpoint = deleteSeries
      ? `/opportunities/${opportunity.id}?series=true`
      : `/opportunities/${opportunity.id}`;
    const response = await apiRequest(endpoint, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage('error', errorBody?.error || 'Failed to close opportunity.');
      return;
    }

    if (selectedOpportunityId === opportunity.id) {
      clearEditForm();
    }

    if (deleteSeries) {
      const body = await response.json().catch(() => ({}));
      const skipped = Number(body.skipped || 0);
      const deleted = Number(body.deleted || 0);
      setMessage(
        'success',
        `Series delete complete: ${deleted} removed${skipped ? `, ${skipped} skipped (accepted applications)` : ''}.`
      );
    } else {
      setMessage('success', 'Opportunity closed.');
    }
    await fetchOpportunities();
  } catch (error) {
    console.error('[Admin] close opportunity error:', error);
    setMessage('error', 'Network error while closing opportunity.');
  }
}

async function enforceAdminAccess() {
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return null;
  }
  currentUserRole = user?.role || null;
  applyRoleVisibility(user);
  return user;
}

function attachEventListeners() {
  statusFilter?.addEventListener('change', async () => {
    clearEditForm();
    setMessage();
    await fetchOpportunities();
  });

  editForm?.addEventListener('submit', saveOpportunity);

  cancelEditButton?.addEventListener('click', () => {
    setMessage();
    clearEditForm();
  });

  startDateInput?.addEventListener('change', () => {
    setDateConstraint();
    validateFormDates();
  });

  endDateInput?.addEventListener('change', () => {
    validateFormDates();
  });

  addShiftNoteButton?.addEventListener('click', (event) => {
    event.preventDefault();
    addShiftNote();
  });

  logoutButton?.addEventListener('click', (event) => {
    event.preventDefault();
    logout();
  });
}

async function loadQualifications() {
  if (!qualificationSelect) return;
  try {
    const res = await apiRequest('/qualifications', { method: 'GET' });
    if (!res.ok) {
      qualificationSelect.innerHTML = '<option disabled>Unable to load</option>';
      return;
    }
    allQualifications = await res.json();
    qualificationSelect.innerHTML = '';
    if (!allQualifications.length) {
      qualificationSelect.innerHTML = '<option disabled value="">None defined</option>';
      return;
    }
    allQualifications.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = String(q.id);
      opt.textContent = q.name;
      qualificationSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('[Admin] loadQualifications error:', error);
  }
}

async function loadTags() {
  try {
    const res = await apiRequest('/tags', { method: 'GET' });
    if (!res.ok) {
      renderTagChips(opportunityTagsEl, [], []);
      return;
    }
    allTags = await res.json();
    renderTagChips(opportunityTagsEl, allTags, []);
  } catch (error) {
    console.error('[Admin] loadTags error:', error);
    renderTagChips(opportunityTagsEl, [], []);
  }
}

async function init() {
  await requireAuth();
  await enforceAdminAccess();
  attachEventListeners();
  clearEditForm();
  await loadQualifications();
  await loadTags();
  await fetchOpportunities();
}

document.addEventListener('DOMContentLoaded', init);
