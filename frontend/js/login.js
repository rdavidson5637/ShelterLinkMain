import { apiRequest } from './config.js';
import { redirectIfAuthenticated, hasPendingWaivers } from './auth.js';
import { showFormErrors, clearFormErrors } from './utils/formErrors.js';

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

  clearFormErrors(form);
  const submitButton = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const errors = [];
  if (!String(payload.email || '').trim()) {
    errors.push({ field: 'email', message: 'Enter your email address.' });
  }
  if (!String(payload.password || '')) {
    errors.push({ field: 'password', message: 'Enter your password.' });
  }
  if (errors.length) {
    showFormErrors(form, errors);
    return;
  }

  if (submitButton) submitButton.setAttribute('disabled', 'true');
  showMessage('');

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
      showFormErrors(form, [
        { field: 'email', message: errorData.error || 'Invalid email or password.' },
      ]);
    }
  } catch (error) {
    showFormErrors(form, [{ message: 'Network error. Please try again later.' }]);
  } finally {
    if (submitButton) submitButton.removeAttribute('disabled');
  }
}

async function loadDemoHints() {
  const card = document.getElementById('demoAccountsCard');
  const list = document.getElementById('demoAccountsList');
  if (!card || !list) return;
  try {
    const res = await apiRequest('/public/demo-info');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.showDemoHints || !Array.isArray(data.accounts) || !data.accounts.length) {
      return;
    }
    list.innerHTML = '';
    data.accounts.forEach((account) => {
      const row = document.createElement('p');
      const meta = document.createElement('span');
      meta.textContent = `${account.label || account.role}: ${account.email}`;
      row.appendChild(meta);
      row.appendChild(document.createTextNode(' '));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary outline';
      btn.textContent = 'Fill';
      btn.addEventListener('click', () => {
        const email = document.getElementById('email');
        const password = document.getElementById('password');
        if (email) email.value = account.email || '';
        if (password) password.value = account.password || '';
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
    card.hidden = false;
  } catch (error) {
    console.warn('[Login] demo hints unavailable:', error.message);
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
  loadDemoHints().catch(() => {});
});
