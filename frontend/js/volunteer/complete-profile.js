import { apiRequest } from '../config.js';
import { requireAuth } from '../auth.js';
import { renderTagChips, getSelectedTagIds } from '../components/tagChips.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';

const form = document.getElementById('profileForm');
const messageEl = document.getElementById('message');
const dobInput = document.getElementById('date_of_birth');
const submitButton = document.getElementById('submitButton');
const customFieldsContainer = document.getElementById('customFieldsContainer');
const interestTagsEl = document.getElementById('interestTags');
const saveInterestsButton = document.getElementById('saveInterestsButton');
const saveFosterButton = document.getElementById('saveFosterButton');
const saveAwayButton = document.getElementById('saveAwayButton');
const awayUntilInput = document.getElementById('away_until');

const FOSTER_BOOL_FIELDS = [
  'has_garden',
  'garden_secure',
  'has_other_dogs',
  'has_other_cats',
  'has_children_under_16',
  'can_medicate',
];

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

function collectFosterFields(formElement) {
  const data = new FormData(formElement);
  const payload = {
    home_type: data.get('home_type') || null,
    max_foster_size: data.get('max_foster_size') || null,
    foster_notes: data.get('foster_notes') || null,
  };
  FOSTER_BOOL_FIELDS.forEach((key) => {
    const el = formElement.elements.namedItem(key);
    payload[key] = el && el.checked ? 1 : 0;
  });
  return payload;
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
    ...collectFosterFields(formElement),
  };
}

function fillForm(profile = {}) {
  Object.entries(profile).forEach(([key, value]) => {
    if (key === 'custom_fields' || key === 'custom_field_values' || key === 'tags' || key === 'tag_ids') {
      return;
    }
    const field = form.elements.namedItem(key);
    if (!field) return;
    if (key === 'away_until') {
      field.value = value ? String(value).slice(0, 10) : '';
      return;
    }
    if (value === undefined || value === null) return;
    if (field.type === 'checkbox') {
      field.checked = value === 1 || value === true || value === '1';
      return;
    }
    field.value = value;
  });
}

function setFormViewOnly(isViewOnly) {
  if (!form) return;
  const elements = form.querySelectorAll('input, textarea, select');
  elements.forEach((el) => {
    if (el.type === 'hidden') return;
    const inFoster = el.closest('#fosterHomeSection');
    const inAway = el.closest('#awayModeSection');
    if (inFoster || inAway) {
      el.readOnly = false;
      el.disabled = false;
      return;
    }
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

async function saveFosterHome() {
  setMessage();
  if (!form) return;
  try {
    const response = await apiRequest('/volunteer/profile', {
      method: 'PUT',
      body: collectFosterFields(form),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage('error', errorBody?.error || 'Failed to save foster home details');
      return;
    }
    setMessage('success', 'Foster home details updated.');
  } catch (error) {
    console.error('[Profile] saveFosterHome error:', error);
    setMessage('error', 'Network error while saving foster home details');
  }
}

async function saveAwayMode() {
  setMessage();
  try {
    const awayUntil = awayUntilInput?.value || null;
    const response = await apiRequest('/volunteer/profile', {
      method: 'PUT',
      body: { away_until: awayUntil || null },
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage('error', errorBody?.error || 'Failed to save away mode');
      return;
    }
    setMessage(
      'success',
      awayUntil ? `Away mode set until ${awayUntil}.` : 'Away mode cleared.'
    );
  } catch (error) {
    console.error('[Profile] saveAwayMode error:', error);
    setMessage('error', 'Network error while saving away mode');
  }
}

function collectNotificationPrefs() {
  return {
    prefer_urgent: document.getElementById('prefer_urgent')?.checked ? 1 : 0,
    prefer_reminders: document.getElementById('prefer_reminders')?.checked ? 1 : 0,
    prefer_threads: document.getElementById('prefer_threads')?.checked ? 1 : 0,
    prefer_fosters: document.getElementById('prefer_fosters')?.checked ? 1 : 0,
  };
}

function fillNotificationPrefs(prefs = {}) {
  const map = [
    ['prefer_urgent', 1],
    ['prefer_reminders', 1],
    ['prefer_threads', 0],
    ['prefer_fosters', 0],
  ];
  map.forEach(([id, fallback]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const raw = prefs[id];
    el.checked = raw == null ? Boolean(fallback) : Number(raw) === 1;
  });
}

async function loadNotificationPrefs() {
  try {
    const res = await apiRequest('/push/prefs', { method: 'GET' });
    if (!res.ok) return;
    const prefs = await res.json();
    fillNotificationPrefs(prefs);
    const status = document.getElementById('pushStatus');
    if (status && prefs.configured === false) {
      status.textContent = 'Browser push is not configured on this server (email alerts still work).';
    }
  } catch (error) {
    console.error('[Profile] loadNotificationPrefs error:', error);
  }
}

async function saveNotificationPrefs() {
  setMessage();
  try {
    const res = await apiRequest('/push/prefs', {
      method: 'PUT',
      body: collectNotificationPrefs(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage('error', body.error || 'Failed to save notification preferences');
      return;
    }
    setMessage('success', 'Notification preferences saved.');
  } catch (error) {
    console.error('[Profile] saveNotificationPrefs error:', error);
    setMessage('error', 'Network error saving notification preferences');
  }
}

async function enableBrowserPush() {
  const status = document.getElementById('pushStatus');
  try {
    const keyRes = await apiRequest('/push/vapid-public-key', { method: 'GET' });
    const keyBody = await keyRes.json().catch(() => ({}));
    if (!keyRes.ok || !keyBody.publicKey) {
      if (status) status.textContent = keyBody.error || 'Push is not available.';
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (status) status.textContent = 'This browser does not support push notifications.';
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (status) status.textContent = 'Notification permission was not granted.';
      return;
    }
    // Minimal registration: subscribe without a custom SW file when unsupported.
    const reg = await navigator.serviceWorker.getRegistration()
      || await navigator.serviceWorker.register('/sw.js').catch(() => null);
    if (!reg) {
      if (status) {
        status.textContent =
          'Preferences saved for when a service worker is available. Enable push again after deploy includes /sw.js.';
      }
      await saveNotificationPrefs();
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
    });
    const res = await apiRequest('/push/subscribe', {
      method: 'POST',
      body: { subscription: sub.toJSON() },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (status) status.textContent = body.error || 'Failed to save push subscription';
      return;
    }
    await saveNotificationPrefs();
    if (status) status.textContent = 'Browser push enabled.';
  } catch (error) {
    console.error('[Profile] enableBrowserPush error:', error);
    if (status) status.textContent = 'Could not enable browser push.';
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
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
      if (saveFosterButton) saveFosterButton.hidden = false;
      if (saveAwayButton) saveAwayButton.hidden = false;
      return profile;
    }

    setMessage('success', 'Profile pending approval. We will notify you once approved.');
    if (submitButton) submitButton.disabled = true;
    setFormViewOnly(true);
    if (saveInterestsButton) saveInterestsButton.hidden = false;
    if (saveFosterButton) saveFosterButton.hidden = false;
    if (saveAwayButton) saveAwayButton.hidden = false;
    return profile;
  } catch (error) {
    console.error('[Profile] checkExistingProfile error:', error);
    return null;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();
  clearFormErrors(form);

  if (!form) return;

  const payload = formDataToPayload(form);
  const errors = [];
  if (!payload.date_of_birth) errors.push({ field: 'date_of_birth', message: 'Enter your date of birth.' });
  if (!payload.emergency_contact) {
    errors.push({ field: 'emergency_contact', message: 'Enter an emergency contact name and phone number.' });
  }
  if (!payload.address) errors.push({ field: 'address', message: 'Enter your address.' });
  if (!payload.availability) errors.push({ field: 'availability', message: 'Select your availability.' });
  if (errors.length) {
    showFormErrors(form, errors);
    return;
  }

  try {
    const response = await apiRequest('/volunteer/profile', {
      method: 'POST',
      body: payload,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody?.error || 'Failed to save profile';
      showFormErrors(form, [{ message: errorMessage }]);
      return;
    }

    setMessage('success', 'Profile completed! Redirecting to dashboard...');
    setTimeout(() => {
      window.location.href = '/pages/volunteer/dashboard.html';
    }, 1500);
  } catch (error) {
    console.error('[Profile] submit error:', error);
    showFormErrors(form, [{ message: 'Network error while saving profile' }]);
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

  saveFosterButton?.addEventListener('click', (event) => {
    event.preventDefault();
    saveFosterHome();
  });

  saveAwayButton?.addEventListener('click', (event) => {
    event.preventDefault();
    saveAwayMode();
  });

  document.getElementById('savePrefsButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    saveNotificationPrefs();
  });
  document.getElementById('enablePushButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    enableBrowserPush();
  });

  await loadNotificationPrefs();
  if (existingProfile) {
    fillNotificationPrefs(existingProfile);
  }
}

document.addEventListener('DOMContentLoaded', init);
