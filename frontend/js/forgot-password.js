import { apiRequest } from '/js/config.js';
import { showFormErrors, clearFormErrors } from '/js/utils/formErrors.js';
import { forgotPasswordFeedback } from '/js/utils/forgotPasswordCopy.js';

const form = document.getElementById('forgotForm');
const messageEl = document.getElementById('message');
const submitButton = document.getElementById('submitButton');

const MESSAGE_CLASS = { error: 'error-message', success: 'success-message', info: 'info-message' };

function showMessage(text, type = 'info') {
  const p = document.createElement('p');
  p.className = MESSAGE_CLASS[type] || MESSAGE_CLASS.info;
  p.textContent = text;
  messageEl.replaceChildren(p);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors(form);
  const email = document.getElementById('email').value.trim();
  if (!email) {
    showFormErrors(form, [{ field: 'email', message: 'Enter your email address.' }]);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';
  messageEl.replaceChildren();

  try {
    const res = await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });

    const data = await res.json().catch(() => ({}));
    const feedback = forgotPasswordFeedback(res, data);
    showMessage(feedback.text, feedback.type);
    if (feedback.hideForm) {
      form.hidden = true;
    } else {
      submitButton.disabled = false;
      submitButton.textContent = 'Send Reset Link';
    }
  } catch (err) {
    showFormErrors(form, [{ message: 'Network error. Please check your connection and try again.' }]);
    submitButton.disabled = false;
    submitButton.textContent = 'Send Reset Link';
  }
});
