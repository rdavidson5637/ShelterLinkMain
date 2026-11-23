import { apiRequest } from './config.js';
import { redirectIfAuthenticated } from './auth.js';
import { showFormErrors, clearFormErrors } from './utils/formErrors.js';
import { loadBrand, applyShelterBrand } from './brand.js';
import { currentShelterSlug } from './shelterSlug.js';
import {
  getPasswordChecks,
  allPasswordChecksPass,
  getStrengthInfo,
} from './utils/passwordStrength.js';

const form = document.getElementById('registerForm');
const messageEl = document.getElementById('message');
const passwordInput = document.getElementById('password');
const submitButton = form?.querySelector('[type="submit"]');
const shelterSlug = currentShelterSlug();
const UNKNOWN_SHELTER_TEXT = 'We could not find that shelter. Check the link and try again.';
let shelterMissing = false;

let meterTextEl = null;
let checklistItems = null;

function updateSubmitState() {
  if (!submitButton || !passwordInput) return;
  if (shelterMissing) {
    submitButton.disabled = true;
    return;
  }
  const checks = getPasswordChecks(passwordInput.value);
  submitButton.disabled = !allPasswordChecksPass(checks);
}

function renderChecklistItem(li, passed, text, idle) {
  if (!li) return;
  if (idle) {
    li.textContent = text;
    li.style.color = 'var(--text-secondary)';
    return;
  }
  li.textContent = `${passed ? '✓' : '✗'} ${text}`;
  li.style.color = passed ? 'var(--green)' : 'var(--danger)';
}

function updatePasswordFeedback() {
  if (!passwordInput || !meterTextEl || !checklistItems) return;
  const value = passwordInput.value;
  const checks = getPasswordChecks(value);
  const strength = getStrengthInfo(value);

  if (strength.idle) {
    meterTextEl.textContent = 'Strength';
  } else {
    meterTextEl.textContent = `Strength: ${strength.label}`;
  }
  meterTextEl.style.color = strength.color;

  renderChecklistItem(
    checklistItems.minLength,
    checks.minLength,
    'At least 10 characters',
    strength.idle
  );

  updateSubmitState();
}

function setupPasswordFeedback() {
  if (!passwordInput) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'passwordFeedback';
  wrapper.style.marginTop = '0.5rem';
  wrapper.style.padding = '0.75rem';
  wrapper.style.border = '1px solid var(--border)';
  wrapper.style.borderRadius = '8px';
  wrapper.style.background = 'var(--surface)';

  meterTextEl = document.createElement('p');
  meterTextEl.style.margin = '0 0 0.5rem';
  meterTextEl.style.fontWeight = '700';
  wrapper.appendChild(meterTextEl);

  const checklist = document.createElement('ul');
  checklist.style.margin = '0';
  checklist.style.paddingLeft = '1.25rem';

  const minLengthItem = document.createElement('li');
  checklist.appendChild(minLengthItem);
  wrapper.appendChild(checklist);

  checklistItems = {
    minLength: minLengthItem,
  };

  const passwordLabel = passwordInput.closest('label');
  if (passwordLabel) {
    passwordLabel.appendChild(wrapper);
  }

  passwordInput.addEventListener('input', updatePasswordFeedback);
  updatePasswordFeedback();
}

function showMessage(text = '', type = 'error') {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.className = text ? (type === 'success' ? 'success-message' : 'error-message') : '';
}

async function handleRegister(event) {
  event.preventDefault();
  if (!form) return;
  clearFormErrors(form);

  const checks = getPasswordChecks(passwordInput?.value || '');
  if (!allPasswordChecksPass(checks)) {
    showFormErrors(form, [
      {
        field: 'password',
        message: 'Password must be at least 10 characters.',
      },
    ]);
    return;
  }

  if (submitButton) submitButton.setAttribute('disabled', 'true');
  showMessage('');

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (payload.password !== payload.confirm_password) {
    showFormErrors(form, [
      { field: 'confirm_password', message: 'Passwords do not match.' },
    ]);
    if (submitButton) submitButton.removeAttribute('disabled');
    return;
  }

  const privacyBox = document.getElementById('privacy_notice');
  if (!privacyBox || !privacyBox.checked) {
    showFormErrors(form, [
      { field: 'privacy_notice', message: 'Please confirm you have read the privacy notice.' },
    ]);
    if (submitButton) submitButton.removeAttribute('disabled');
    return;
  }

  const data = {
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    phone: payload.phone,
    password: payload.password,
    privacy_notice: true,
    website: document.getElementById('website')?.value || '',
  };
  if (shelterSlug) data.shelter_slug = shelterSlug;

  try {
    const res = await apiRequest('/auth/register', {
      method: 'POST',
      body: data,
    });

    if (res.status === 201) {
      showMessage('Registration successful! Redirecting to login...', 'success');
      form.reset();
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 2000);
    } else if (res.status === 404 && shelterSlug) {
      markShelterMissing();
    } else {
      const errorData = await res.json().catch(() => ({}));
      const fallback =
        res.status === 429
          ? 'Too many registration attempts. Please try again in 15 minutes.'
          : 'Registration failed. Please try again.';
      showFormErrors(form, [
        {
          field: res.status === 429 ? undefined : 'email',
          message: errorData.error || fallback,
        },
      ]);
    }
  } catch (error) {
    console.error('[Register] Network error:', error);
    showFormErrors(form, [
      {
        message: 'Network error. Check your connection and try again.',
      },
    ]);
  } finally {
    updateSubmitState();
  }
}

function markShelterMissing() {
  shelterMissing = true;
  showMessage(UNKNOWN_SHELTER_TEXT);
  updateSubmitState();
}

// Brand returns 404 for an unknown slug (no Assisi fallback). A mismatch
// means the same: the slug in this link is not a shelter we know.
// On success, fill the heading from the shelter record (no hard-coded names).
async function checkShelter() {
  const brand = await loadBrand();
  if (shelterSlug && (!brand || (brand.slug && brand.slug !== shelterSlug))) {
    markShelterMissing();
    return;
  }
  if (brand) applyShelterBrand(brand);
}

document.addEventListener('DOMContentLoaded', () => {
  redirectIfAuthenticated();
  setupPasswordFeedback();
  updateSubmitState();
  checkShelter();
  if (form) {
    form.addEventListener('submit', handleRegister);
  }
});
