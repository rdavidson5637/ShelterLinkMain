import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { renderTagChips, getSelectedTagIds } from '../components/tagChips.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';

const form = document.getElementById('opportunityForm');
const messageEl = document.getElementById('message');
const startDateInput = document.getElementById('start_date');
const endDateInput = document.getElementById('end_date');
const recurrenceRuleInput = document.getElementById('recurrence_rule');
const recurrenceUntilInput = document.getElementById('recurrence_until');
const recurrenceUntilField = document.getElementById('recurrenceUntilField');
const qualificationSelect = document.getElementById('qualification_ids');
const animalSelect = document.getElementById('animal_ids');
const opportunityTagsEl = document.getElementById('opportunityTags');
const logoutButton = document.getElementById('logoutButton');
const submitButton = document.getElementById('submitButton');
const templateSelect = document.getElementById('templateSelect');
const saveTemplateButton = document.getElementById('saveTemplateButton');
const bgCheckSelect = document.getElementById('required_background_check_type');

let allQualifications = [];
let allAnimals = [];
let allTags = [];
let allTemplates = [];

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
  const selectedAnimals = animalSelect
    ? Array.from(animalSelect.selectedOptions).map((o) => Number(o.value)).filter(Boolean)
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
    animal_ids: selectedAnimals,
    tag_ids: getSelectedTagIds(opportunityTagsEl),
    required_background_check_type: data.get('required_background_check_type') || null,
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
    showFormErrors(form, [{ field: 'end_date', message: 'End date must be on or after start date.' }]);
    return false;
  }
  const rule = recurrenceRuleInput?.value || 'none';
  if (rule !== 'none') {
    const until = recurrenceUntilInput?.value;
    if (!until) {
      showFormErrors(form, [
        { field: 'recurrence_until', message: 'Choose an until date for repeating opportunities.' },
      ]);
      return false;
    }
    if (new Date(until) <= new Date(start)) {
      showFormErrors(form, [
        { field: 'recurrence_until', message: 'Until date must be after the start date.' },
      ]);
      return false;
    }
  }
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();
  clearFormErrors(form);

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
      showFormErrors(form, [{ message: errorMessage }]);
      return;
    }

    form.reset();
    syncRecurrenceFields();
    if (qualificationSelect) {
      Array.from(qualificationSelect.options).forEach((o) => {
        o.selected = false;
      });
    }
    if (animalSelect) {
      Array.from(animalSelect.options).forEach((o) => {
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
    showFormErrors(form, [{ message: 'Network error while creating opportunity' }]);
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

async function loadAnimals() {
  if (!animalSelect) return;
  try {
    const res = await apiRequest('/animals', { method: 'GET' });
    if (!res.ok) {
      animalSelect.innerHTML = '<option disabled>Unable to load animals</option>';
      return;
    }
    allAnimals = await res.json();
    if (!allAnimals.length) {
      animalSelect.innerHTML = '<option disabled value="">No animals defined yet</option>';
      return;
    }
    animalSelect.innerHTML = '';
    allAnimals.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = `${a.name} (${a.species}${a.kennel_ref ? `, ${a.kennel_ref}` : ''})`;
      animalSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('[Admin] loadAnimals error:', error);
    animalSelect.innerHTML = '<option disabled>Unable to load animals</option>';
  }
}

function applyTemplatePayload(payload = {}) {
  if (!form) return;
  if (payload.title != null) form.elements.namedItem('title').value = payload.title || '';
  if (payload.description != null) form.elements.namedItem('description').value = payload.description || '';
  if (payload.location != null) form.elements.namedItem('location').value = payload.location || '';
  if (payload.requirements != null) form.elements.namedItem('requirements').value = payload.requirements || '';
  if (payload.max_volunteers != null && form.elements.namedItem('max_volunteers')) {
    form.elements.namedItem('max_volunteers').value = payload.max_volunteers || '';
  }
  if (payload.cancellation_cutoff_hours != null && form.elements.namedItem('cancellation_cutoff_hours')) {
    form.elements.namedItem('cancellation_cutoff_hours').value =
      payload.cancellation_cutoff_hours ?? 24;
  }
  if (bgCheckSelect) {
    bgCheckSelect.value = payload.required_background_check_type || '';
  }
  const qualIds = new Set((payload.qualification_ids || []).map(String));
  if (qualificationSelect) {
    Array.from(qualificationSelect.options).forEach((o) => {
      o.selected = qualIds.has(String(o.value));
    });
  }
  const animalIds = new Set((payload.animal_ids || []).map(String));
  if (animalSelect) {
    Array.from(animalSelect.options).forEach((o) => {
      o.selected = animalIds.has(String(o.value));
    });
  }
  renderTagChips(opportunityTagsEl, allTags, payload.tag_ids || []);
}

async function loadTemplates() {
  if (!templateSelect) return;
  try {
    const res = await apiRequest('/opportunity-templates', { method: 'GET' });
    if (!res.ok) return;
    allTemplates = await res.json();
    templateSelect.innerHTML = '<option value="">— Blank opportunity —</option>';
    allTemplates.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = String(t.id);
      opt.textContent = t.name;
      templateSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('[Admin] loadTemplates error:', error);
  }
}

async function init() {
  await requireAuth();
  await enforceAdminAccess();
  setDateConstraints();
  await loadQualifications();
  await loadAnimals();
  await loadTags();
  await loadTemplates();

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  templateSelect?.addEventListener('change', () => {
    const id = templateSelect.value;
    if (!id) return;
    const tpl = allTemplates.find((t) => String(t.id) === String(id));
    if (tpl) applyTemplatePayload(tpl.payload || {});
  });

  saveTemplateButton?.addEventListener('click', async () => {
    const name = window.prompt('Template name');
    if (!name || !name.trim()) return;
    const payload = formDataToPayload(form);
    delete payload.start_date;
    delete payload.end_date;
    delete payload.recurrence_rule;
    delete payload.recurrence_until;
    try {
      const res = await apiRequest('/opportunity-templates/from-form', {
        method: 'POST',
        body: { name: name.trim(), ...payload },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage('error', body.error || 'Failed to save template');
        return;
      }
      setMessage('success', 'Template saved.');
      await loadTemplates();
    } catch (error) {
      console.error('[Admin] save template error:', error);
      setMessage('error', 'Network error saving template');
    }
  });

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

