import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { renderTagChips, getSelectedTagIds } from '../components/tagChips.js';

const form = document.getElementById('opportunityForm');
const messageEl = document.getElementById('message');
const startDateInput = document.getElementById('start_date');
const endDateInput = document.getElementById('end_date');
const recurrenceRuleInput = document.getElementById('recurrence_rule');
const recurrenceUntilInput = document.getElementById('recurrence_until');
const recurrenceUntilField = document.getElementById('recurrenceUntilField');
const qualificationSelect = document.getElementById('qualification_ids');
const opportunityTagsEl = document.getElementById('opportunityTags');
const logoutButton = document.getElementById('logoutButton');
const submitButton = document.getElementById('submitButton');

let allQualifications = [];
let allTags = [];

function setDateConstraints() {
  if (!startDateInput) return;
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
  startDateInput.min = todayISO;
  if (endDateInput && !endDateInput.min) {
    endDateInput.min = todayISO;
  }
}

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const tone = type === 'error' ? 'error' : 'success';
  messageEl.innerHTML = `<p class="${tone}">${text}</p>`;
}

function syncRecurrenceFields() {
  const repeating = recurrenceRuleInput && recurrenceRuleInput.value !== 'none';
  if (recurrenceUntilField) {
    recurrenceUntilField.hidden = !repeating;
  }
  if (recurrenceUntilInput) {
    recurrenceUntilInput.required = Boolean(repeating);
    if (!repeating) {
      recurrenceUntilInput.value = '';
    } else if (startDateInput?.value) {
      recurrenceUntilInput.min = startDateInput.value;
    }
  }
}

function formDataToPayload(formElement) {
  const data = new FormData(formElement);
  const recurrence_rule = data.get('recurrence_rule') || 'none';
  const selectedQuals = qualificationSelect
    ? Array.from(qualificationSelect.selectedOptions).map((o) => Number(o.value)).filter(Boolean)
    : [];
  const payload = {
    title: data.get('title'),
    description: data.get('description'),
    location: data.get('location'),
    start_date: data.get('start_date'),
    end_date: data.get('end_date'),
    requirements: data.get('requirements'),
    max_volunteers: data.get('max_volunteers') ? Number(data.get('max_volunteers')) : null,
    cancellation_cutoff_hours: data.get('cancellation_cutoff_hours')
      ? Number(data.get('cancellation_cutoff_hours'))
      : 24,
    recurrence_rule,
    qualification_ids: selectedQuals,
    tag_ids: getSelectedTagIds(opportunityTagsEl),
  };
  if (recurrence_rule !== 'none') {
    payload.recurrence_until = data.get('recurrence_until') || null;
  }
  return payload;
}

function validateDates() {
  if (!startDateInput || !endDateInput) return true;
  const start = startDateInput.value;
  const end = endDateInput.value;
  if (!start || !end) return true;
  if (new Date(end) < new Date(start)) {
    setMessage('error', 'End date must be on or after start date.');
    return false;
  }
  const rule = recurrenceRuleInput?.value || 'none';
  if (rule !== 'none') {
    const until = recurrenceUntilInput?.value;
    if (!until) {
      setMessage('error', 'Please choose an Until date for repeating opportunities.');
      return false;
    }
    if (new Date(until) <= new Date(start)) {
      setMessage('error', 'Until date must be after the start date.');
      return false;
    }
  }
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();

  if (!validateDates()) {
    return;
  }

  submitButton?.setAttribute('disabled', 'true');

  try {
    const payload = formDataToPayload(form);
    const response = await apiRequest('/opportunities', {
      method: 'POST',
      body: payload,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody?.error || 'Failed to create opportunity';
      setMessage('error', errorMessage);
      return;
    }

    form.reset();
    syncRecurrenceFields();
    if (qualificationSelect) {
      Array.from(qualificationSelect.options).forEach((o) => {
        o.selected = false;
      });
    }
    renderTagChips(opportunityTagsEl, allTags, []);
    const created = await response.json().catch(() => ({}));
    const seriesNote =
      created?.series_count > 1 ? ` (${created.series_count} shifts in series)` : '';
    setMessage('success', `Opportunity created successfully${seriesNote}! Redirecting...`);
    setTimeout(() => {
      window.location.href = '/pages/admin/opportunities.html';
    }, 1500);
  } catch (error) {
    console.error('[Admin] create opportunity error:', error);
    setMessage('error', 'Network error while creating opportunity');
  } finally {
    submitButton?.removeAttribute('disabled');
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

async function loadQualifications() {
  if (!qualificationSelect) return;
  try {
    const res = await apiRequest('/qualifications', { method: 'GET' });
    if (!res.ok) {
      qualificationSelect.innerHTML = '<option disabled>Unable to load qualifications</option>';
      return;
    }
    allQualifications = await res.json();
    if (!allQualifications.length) {
      qualificationSelect.innerHTML = '<option disabled value="">No qualifications defined</option>';
      return;
    }
    qualificationSelect.innerHTML = '';
    allQualifications.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = String(q.id);
      opt.textContent = q.validity_months
        ? `${q.name} (${q.validity_months} mo)`
        : q.name;
      qualificationSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('[Admin] loadQualifications error:', error);
    qualificationSelect.innerHTML = '<option disabled>Unable to load qualifications</option>';
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
  setDateConstraints();
  await loadQualifications();
  await loadTags();

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  if (startDateInput && endDateInput) {
    startDateInput.addEventListener('change', () => {
      endDateInput.min = startDateInput.value || startDateInput.min;
      if (endDateInput.value && new Date(endDateInput.value) < new Date(startDateInput.value)) {
        endDateInput.value = '';
      }
      syncRecurrenceFields();
    });
    endDateInput.addEventListener('change', () => {
      validateDates();
    });
  }

  recurrenceRuleInput?.addEventListener('change', () => {
    syncRecurrenceFields();
    validateDates();
  });
  recurrenceUntilInput?.addEventListener('change', () => {
    validateDates();
  });

  syncRecurrenceFields();
}

document.addEventListener('DOMContentLoaded', init);


