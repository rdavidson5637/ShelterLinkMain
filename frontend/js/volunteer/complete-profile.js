import { apiRequest } from '../config.js';
import { requireAuth } from '../auth.js';
import { renderTagChips, getSelectedTagIds } from '../components/tagChips.js';

const form = document.getElementById('profileForm');
const messageEl = document.getElementById('message');
const dobInput = document.getElementById('date_of_birth');
const submitButton = document.getElementById('submitButton');
const customFieldsContainer = document.getElementById('customFieldsContainer');
const interestTagsEl = document.getElementById('interestTags');
const saveInterestsButton = document.getElementById('saveInterestsButton');

let activeCustomFields = [];
let allTags = [];

function setDateBounds() {
  if (!dobInput) return;
  const today = new Date();
  const max = today.toISOString().split('T')[0];
  const min = new Date(today);
  min.setFullYear(today.getFullYear() - 80);
  const minString = min.toISOString().split('T')[0];
  dobInput.max = max;
  dobInput.min = minString;
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

function collectCustomFieldValues() {
  const values = {};
  activeCustomFields.forEach((field) => {
    const el = form?.querySelector(`[data-custom-field-id="${field.id}"]`);
    if (!el) {
      values[field.id] = field.field_type === 'checkbox' ? '0' : '';
      return;
    }
    if (field.field_type === 'checkbox') {
      values[field.id] = el.checked ? '1' : '0';
    } else {
      values[field.id] = el.value;
    }
  });
  return values;
}

function renderCustomFields(fields = [], valuesById = {}) {
  if (!customFieldsContainer) return;
  activeCustomFields = fields;

  if (!fields.length) {
    customFieldsContainer.hidden = true;
    customFieldsContainer.innerHTML = '';
    return;
  }

  customFieldsContainer.hidden = false;
  customFieldsContainer.innerHTML = '';

  fields.forEach((field) => {
    const wrapper = document.createElement('div');
    wrapper.className =
      field.field_type === 'checkbox' ? 'form-section form-full-width' : 'form-section form-full-width';

    const name = `custom_field_${field.id}`;
    const current = valuesById[field.id] != null ? valuesById[field.id] : '';
    const requiredMark = field.required ? ' *' : '';

    if (field.field_type === 'checkbox') {
      const label = document.createElement('label');
      label.setAttribute('for', name);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = name;
      input.name = name;
      input.dataset.customFieldId = String(field.id);
      input.checked = current === '1' || current === true || current === 1;
      if (field.required) input.required = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${field.label}${requiredMark}`));
      wrapper.appendChild(label);
    } else if (field.field_type === 'select') {
      const label = document.createElement('label');
      label.setAttribute('for', name);
      label.textContent = `${field.label}${requiredMark}`;
      const select = document.createElement('select');
      select.id = name;
      select.name = name;
      select.dataset.customFieldId = String(field.id);
      if (field.required) select.required = true;

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.disabled = true;
      placeholder.selected = !current;
      placeholder.textContent = 'Select an option';
      select.appendChild(placeholder);

      (field.options || []).forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (String(current) === String(opt)) option.selected = true;
        select.appendChild(option);
      });

      label.appendChild(select);
      wrapper.appendChild(label);
    } else if (field.field_type === 'date') {
      const label = document.createElement('label');
      label.setAttribute('for', name);
      label.textContent = `${field.label}${requiredMark}`;
      const input = document.createElement('input');
      input.type = 'date';
      input.id = name;
      input.name = name;
      input.dataset.customFieldId = String(field.id);
      input.value = current ? String(current).slice(0, 10) : '';
      if (field.required) input.required = true;
      label.appendChild(input);
      wrapper.appendChild(label);
    } else {
      const label = document.createElement('label');
      label.setAttribute('for', name);
      label.textContent = `${field.label}${requiredMark}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = name;
      input.name = name;
      input.dataset.customFieldId = String(field.id);
      input.value = current != null ? String(current) : '';
      if (field.required) input.required = true;
      label.appendChild(input);
      wrapper.appendChild(label);
    }

    customFieldsContainer.appendChild(wrapper);
  });
}

function formDataToPayload(formElement) {
  const data = new FormData(formElement);
  return {
    date_of_birth: data.get('date_of_birth'),
    address: data.get('address'),
    emergency_contact: data.get('emergency_contact'),
    skills: data.get('skills'),
    availability: data.get('availability'),
    custom_fields: collectCustomFieldValues(),
    tag_ids: getSelectedTagIds(interestTagsEl),
  };
}

function fillForm(profile = {}) {
  Object.entries(profile).forEach(([key, value]) => {
    if (key === 'custom_fields' || key === 'custom_field_values' || key === 'tags' || key === 'tag_ids') {
      return;
    }
    const field = form.elements.namedItem(key);
    if (field && value !== undefined && value !== null) {
      field.value = value;
    }
  });
}

function setFormViewOnly(isViewOnly) {
  if (!form) return;
  const elements = form.querySelectorAll('input, textarea, select');
  elements.forEach((el) => {
    if (el.type === 'hidden') return;
    el.readOnly = isViewOnly && el.tagName !== 'SELECT' && el.type !== 'checkbox';
    el.disabled = isViewOnly && (el.tagName === 'SELECT' || el.type === 'checkbox');
  });
}

async function loadTags(selectedIds = []) {
  try {
    const res = await apiRequest('/tags', { method: 'GET' });
    if (!res.ok) {
      renderTagChips(interestTagsEl, [], []);
      return;
    }
    allTags = await res.json();
    renderTagChips(interestTagsEl, allTags, selectedIds, { disabled: false });
  } catch (error) {
    console.error('[Profile] loadTags error:', error);
    renderTagChips(interestTagsEl, [], []);
  }
}

async function loadCustomFields(profile = null) {
  try {
    const res = await apiRequest('/custom-fields/active', { method: 'GET' });
    if (!res.ok) {
      renderCustomFields([]);
      return;
    }
    const fields = await res.json();
    const valuesById = {};
    if (profile?.custom_fields) {
      profile.custom_fields.forEach((f) => {
        valuesById[f.id] = f.value;
      });
    } else if (profile?.custom_field_values) {
      profile.custom_field_values.forEach((f) => {
        valuesById[f.field_id] = f.value;
      });
    }
    renderCustomFields(fields, valuesById);
  } catch (error) {
    console.error('[Profile] loadCustomFields error:', error);
    renderCustomFields([]);
  }
}

async function saveInterests() {
  setMessage();
  try {
    const response = await apiRequest('/volunteer/profile', {
      method: 'PUT',
      body: { tag_ids: getSelectedTagIds(interestTagsEl) },
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage('error', errorBody?.error || 'Failed to save interests');
      return;
    }
    setMessage('success', 'Interests updated.');
  } catch (error) {
    console.error('[Profile] saveInterests error:', error);
    setMessage('error', 'Network error while saving interests');
  }
}

async function checkExistingProfile() {
  try {
    const res = await apiRequest('/volunteer/profile', { method: 'GET' });
    if (!res.ok) return null;
    const profile = await res.json();
    if (!profile) return null;

    fillForm(profile);
    await loadCustomFields(profile);
    const selected =
      profile.tag_ids ||
      (profile.tags || []).map((t) => t.id);
    await loadTags(selected);

    if (profile.approved) {
      setMessage('success', 'Your profile is approved. Your details are shown below.');
      setFormViewOnly(true);
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Profile verified';
      }
      if (saveInterestsButton) saveInterestsButton.hidden = false;
      return profile;
    }

    setMessage('success', 'Profile pending approval. We will notify you once approved.');
    if (submitButton) submitButton.disabled = true;
    setFormViewOnly(true);
    if (saveInterestsButton) saveInterestsButton.hidden = false;
    return profile;
  } catch (error) {
    console.error('[Profile] checkExistingProfile error:', error);
    return null;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();

  if (!form) return;

  const payload = formDataToPayload(form);

  try {
    const response = await apiRequest('/volunteer/profile', {
      method: 'POST',
      body: payload,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody?.error || 'Failed to save profile';
      setMessage('error', errorMessage);
      return;
    }

    setMessage('success', 'Profile completed! Redirecting to dashboard...');
    setTimeout(() => {
      window.location.href = '/pages/volunteer/dashboard.html';
    }, 1500);
  } catch (error) {
    console.error('[Profile] submit error:', error);
    setMessage('error', 'Network error while saving profile');
  }
}

async function init() {
  await requireAuth();
  setDateBounds();
  const existingProfile = await checkExistingProfile();

  if (!existingProfile) {
    await loadCustomFields();
    await loadTags([]);
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }
  }

  saveInterestsButton?.addEventListener('click', (event) => {
    event.preventDefault();
    saveInterests();
  });
}

document.addEventListener('DOMContentLoaded', init);
