import { apiRequest } from './config.js';
import { redirectIfAuthenticated } from './auth.js';

const form = document.getElementById('registerForm');
const messageEl = document.getElementById('message');
const passwordInput = document.getElementById('password');
const submitButton = form?.querySelector('[type="submit"]');

let meterTextEl = null;
let checklistItems = null;

function getPasswordChecks(password = '') {
  const value = String(password);
  return {
    minLength: value.length >= 8,
    hasUppercase: /[A-Z]/.test(value),
    hasNumber: /[0-9]/.test(value),
  };
}

function allPasswordChecksPass(checks) {
  return checks.minLength && checks.hasUppercase && checks.hasNumber;
}

function updateSubmitState() {
  if (!submitButton || !passwordInput) return;
  const checks = getPasswordChecks(passwordInput.value);
  submitButton.disabled = !allPasswordChecksPass(checks);
}

function getStrengthInfo(checks, passwordValue = '') {
  const metCount = [checks.minLength, checks.hasUppercase, checks.hasNumber].filter(Boolean).length;
  if (!passwordValue) return { label: 'Weak', color: '#c62828' };
  if (metCount <= 1) return { label: 'Weak', color: '#c62828' };
  if (metCount === 2) return { label: 'Fair', color: '#e65100' };
  return { label: 'Strong', color: '#2e7d32' };
}

function renderChecklistItem(li, passed, text) {
  if (!li) return;
  li.textContent = `${passed ? '✓' : '✗'} ${text}`;
  li.style.color = passed ? '#2e7d32' : '#c62828';
}

function updatePasswordFeedback() {
  if (!passwordInput || !meterTextEl || !checklistItems) return;
  const checks = getPasswordChecks(passwordInput.value);
  const strength = getStrengthInfo(checks, passwordInput.value);

  meterTextEl.textContent = `Strength: ${strength.label}`;
  meterTextEl.style.color = strength.color;

  renderChecklistItem(checklistItems.minLength, checks.minLength, 'At least 8 characters');
  renderChecklistItem(checklistItems.hasUppercase, checks.hasUppercase, 'At least one uppercase letter');
  renderChecklistItem(checklistItems.hasNumber, checks.hasNumber, 'At least one number');

  updateSubmitState();
}

function setupPasswordFeedback() {
  if (!passwordInput) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'passwordFeedback';
  wrapper.style.marginTop = '0.5rem';
  wrapper.style.padding = '0.75rem';
  wrapper.style.border = '1px solid rgba(46, 125, 50, 0.2)';
  wrapper.style.borderRadius = '8px';
  wrapper.style.background = 'rgba(255, 255, 255, 0.9)';

  meterTextEl = document.createElement('p');
  meterTextEl.style.margin = '0 0 0.5rem';
  meterTextEl.style.fontWeight = '700';
  wrapper.appendChild(meterTextEl);

  const checklist = document.createElement('ul');
  checklist.style.margin = '0';
  checklist.style.paddingLeft = '1.25rem';

  const minLengthItem = document.createElement('li');
  const uppercaseItem = document.createElement('li');
  const numberItem = document.createElement('li');
  checklist.appendChild(minLengthItem);
  checklist.appendChild(uppercaseItem);
  checklist.appendChild(numberItem);
  wrapper.appendChild(checklist);

  checklistItems = {
    minLength: minLengthItem,
    hasUppercase: uppercaseItem,
    hasNumber: numberItem,
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

  const checks = getPasswordChecks(passwordInput?.value || '');
  if (!allPasswordChecksPass(checks)) {
    showMessage('Password must be at least 8 characters with one uppercase letter and one number', 'error');
    return;
  }

  if (submitButton) submitButton.setAttribute('disabled', 'true');
  showMessage('');

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (payload.password !== payload.confirm_password) {
    showMessage('Passwords do not match.', 'error');
    if (submitButton) submitButton.removeAttribute('disabled');
    return;
  }

  const data = {
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    phone: payload.phone,
    password: payload.password,
  };

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
    } else {
      const errorData = await res.json().catch(() => ({}));
      showMessage(errorData.error || 'Registration failed. Please try again.', 'error');
    }
  } catch (error) {
    console.error('[Register] Network error:', error);
    showMessage(`Network error: ${error.message || 'Could not connect to server. Make sure the backend is running on port 3000.'}`, 'error');
  } finally {
    if (submitButton) submitButton.removeAttribute('disabled');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  redirectIfAuthenticated();
  setupPasswordFeedback();
  updateSubmitState();
  if (form) {
    form.addEventListener('submit', handleRegister);
  }
});

