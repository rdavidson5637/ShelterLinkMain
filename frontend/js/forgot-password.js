import { apiRequest } from '/js/config.js';
import { showFormErrors, clearFormErrors } from '/js/utils/formErrors.js';
import { forgotPasswordFeedback } from '/js/utils/forgotPasswordCopy.js';

const form = document.getElementById('forgotForm');
const messageEl = document.getElementById('message');
const submitButton = document.getElementById('submitButton');

function showMessage(text, type = 'info') {
  const color = type === 'error' ? '#d93025' : type === 'success' ? '#0f9d58' : '#1a73e8';
  const p = document.createElement('p');
  p.style.cssText = `color:${color};padding:0.75rem;border-radius:6px;background:${color}18;`;
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
      form.style.display = 'none';
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
