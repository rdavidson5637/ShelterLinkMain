import { apiRequest } from './config.js';
import { redirectIfAuthenticated, hasPendingWaivers } from './auth.js';

const form = document.getElementById('loginForm');
const messageEl = document.getElementById('message');
const SESSION_FLAG_KEY = 'session_expired';

function showMessage(text = '', type = 'error') {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.className = text ? (type === 'success' ? 'success-message' : 'error-message') : '';
}

async function redirectToDashboard(role) {
  if (role === 'admin' || role === 'staff') {
    window.location.href = '/pages/admin/dashboard.html';
    return;
  }
  if (await hasPendingWaivers()) {
    window.location.href = '/pages/volunteer/accept-waiver.html';
    return;
  }
  window.location.href = '/pages/volunteer/dashboard.html';
}

async function handleLogin(event) {
  event.preventDefault();
  if (!form) return;

  const submitButton = form.querySelector('[type=\"submit\"]');
  if (submitButton) submitButton.setAttribute('disabled', 'true');
  showMessage('');

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
      }),
    });

    if (res.ok) {
      const user = await res.json();
      showMessage('Login successful! Redirecting...', 'success');
      setTimeout(() => redirectToDashboard(user.role), 1000);
    } else {
      const errorData = await res.json().catch(() => ({}));
      showMessage(errorData.error || 'Invalid credentials.', 'error');
    }
  } catch (error) {
    showMessage('Network error. Please try again later.', 'error');
  } finally {
    if (submitButton) submitButton.removeAttribute('disabled');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const expired = sessionStorage.getItem(SESSION_FLAG_KEY);
  if (expired) {
    showMessage(
      'Your session expired after 60 minutes of inactivity. Please log in again.',
      'error'
    );
    messageEl.style.background = '#ffecb3';
    messageEl.style.borderLeft = '4px solid #ffb300';
    messageEl.style.color = '#7a4f01';
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  }

  redirectIfAuthenticated();
  if (form) {
    form.addEventListener('submit', handleLogin);
  }
});

