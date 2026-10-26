import { apiRequest } from '/js/config.js';
import { showFormErrors, clearFormErrors } from '/js/utils/formErrors.js';

const form = document.getElementById('resetForm');
const messageEl = document.getElementById('message');
const submitButton = document.getElementById('submitButton');
const loginLink = document.getElementById('loginLink');

const MESSAGE_CLASS = { error: 'error-message', success: 'success-message', info: 'info-message' };

function showMessage(text, type = 'info') {
  const p = document.createElement('p');
  p.className = MESSAGE_CLASS[type] || MESSAGE_CLASS.info;
  p.textContent = text;
  messageEl.replaceChildren(p);
}

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

if (!token) {
  showMessage('Invalid reset link. Please request a new password reset.', 'error');
  form.hidden = true;
  loginLink.hidden = false;
} else {
  try {
    const check = await apiRequest(`/auth/reset-password/${encodeURIComponent(token)}`);
    const checkData = await check.json().catch(() => ({ valid: false }));
    if (!checkData.valid) {
      showMessage('Invalid or expired reset link. Please request a new password reset.', 'error');
      form.hidden = true;
      loginLink.hidden = false;
    }
  } catch {
    showMessage('Unable to verify this reset link. Please try again.', 'error');
    form.hidden = true;
    loginLink.hidden = false;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors(form);

  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm_password').value;

  if (password !== confirm) {
    showFormErrors(form, [{ field: 'confirm_password', message: 'Passwords do not match.' }]);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Updating…';
  messageEl.replaceChildren();

  try {
    const res = await apiRequest('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showMessage('Password updated successfully! Redirecting to sign in…', 'success');
      form.hidden = true;
      loginLink.hidden = false;
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 2500);
    } else {
      showFormErrors(form, [{ field: 'password', message: data.error || 'Something went wrong. Please try again.' }]);
      submitButton.disabled = false;
      submitButton.textContent = 'Set New Password';
    }
  } catch (err) {
    showFormErrors(form, [{ message: 'Network error. Please check your connection and try again.' }]);
    submitButton.disabled = false;
    submitButton.textContent = 'Set New Password';
  }
});
