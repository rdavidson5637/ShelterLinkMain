import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { renderTagChips, getSelectedTagIds, setSelectedTagIds } from '../components/tagChips.js';

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
const endDateInput = document.getElementById('end_date');
const maxVolunteersInput = document.getElementById('max_volunteers');
const cancellationCutoffInput = document.getElementById('cancellation_cutoff_hours');
const activityNotesInput = document.getElementById('activity_notes');
const requirementsInput = document.getElementById('requirements');
const qualificationSelect = document.getElementById('qualification_ids');
const opportunityTagsEl = document.getElementById('opportunityTags');

let opportunities = [];
let selectedOpportunityId = null;
let allQualifications = [];
let allTags = [];

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cssClass = type === 'error' ? 'error-message' : 'success-message';
  messageEl.innerHTML = `<p class="${cssClass}">${text}</p>`;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString();
}

function formatDateRange(opportunity) {
  const start = formatDate(opportunity.start_date);
  const end = formatDate(opportunity.end_date);
  return `${start} - ${end}`;
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
  return true;
}

function populateEditForm(opportunity) {
  selectedOpportunityId = opportunity.id;
  if (idInput) idInput.value = String(opportunity.id);
  if (titleInput) titleInput.value = opportunity.title || '';
  if (descriptionInput) descriptionInput.value = opportunity.description || '';
  if (locationInput) locationInput.value = opportunity.location || '';
  if (startDateInput) startDateInput.value = (opportunity.start_date || '').slice(0, 10);
  if (endDateInput) endDateInput.value = (opportunity.end_date || '').slice(0, 10);
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
}

function getFilteredOpportunities() {
  const selectedStatus = statusFilter?.value || '';
  if (!selectedStatus) return opportunities;
  return opportunities.filter((opportunity) => opportunity.status === selectedStatus);
}

function createStatusBadge(status) {
  const tone = status === 'closed' ? 'closed' : 'open';
  return `<span class="status-badge ${tone}">${status || 'open'}</span>`;
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
  return ` <span class="status-badge open" title="${label}" aria-label="${label}">↻</span>`;
}

function createCheckInCodeBadge(opportunity) {
  if (!opportunity.check_in_code) return '';
  return ` <code title="Check-in code" style="font-size:0.85em;">${opportunity.check_in_code}</code>`;
}

function renderOpportunitiesTable() {
  if (!tableBody) return;
  const filtered = getFilteredOpportunities();

  if (!filtered.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No opportunities found.</td></tr>';
    return;
  }

  tableBody.innerHTML = '';

  filtered.forEach((opportunity) => {
    const tr = document.createElement('tr');

    const titleTd = document.createElement('td');
    titleTd.innerHTML = `${opportunity.title || 'Untitled'}${createRepeatIndicator(opportunity)}${createCheckInCodeBadge(opportunity)}`;

    const locationTd = document.createElement('td');
    locationTd.textContent = opportunity.location || 'N/A';

    const datesTd = document.createElement('td');
    datesTd.textContent = formatDateRange(opportunity);

    const statusTd = document.createElement('td');
    statusTd.innerHTML = createStatusBadge(opportunity.status);

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
    start_date: startDateInput?.value,
    end_date: endDateInput?.value,
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
