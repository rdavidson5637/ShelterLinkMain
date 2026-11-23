import { apiRequest } from './config.js';
import { redirectIfAuthenticated, hasPendingWaivers } from './auth.js';
import { showFormErrors, clearFormErrors } from './utils/formErrors.js';
import { clearUserCache, getRegistration } from './pwa.js';
import { pendingCheckinPath } from './utils/pendingCheckin.js';

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
  // Signed in after scanning a shift poster: go back to that check-in.
  window.location.href = pendingCheckinPath() || '/pages/volunteer/dashboard.html';
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
    let pushEndpoint;
    try {
      pushEndpoint = await Promise.race([
        getRegistration()
          .then((reg) => reg?.pushManager?.getSubscription())
          .then((sub) => sub?.endpoint),
        new Promise((resolve) => setTimeout(() => resolve(undefined), 2000)),
      ]);
    } catch {
      pushEndpoint = undefined;
    }

    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
        rememberMe: Boolean(payload.rememberMe || document.getElementById('rememberMe')?.checked),
        pushEndpoint,
      }),
    });

    if (res.ok) {
      const user = await res.json();
      if (user.twoFactorRequired === true) {
        showTwoFactorStep();
        return;
      }
      await finishSignIn(user);
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

const twoFactorForm = document.getElementById('twoFactorForm');

function showTwoFactorStep() {
  if (!form || !twoFactorForm) return;
  const password = document.getElementById('password');
  if (password) password.value = '';
  form.hidden = true;
  twoFactorForm.hidden = false;
  showMessage('');
  document.getElementById('twoFactorCode')?.focus();
}

function backToPasswordStep(text = '') {
  if (!form || !twoFactorForm) return;
  twoFactorForm.reset();
  clearFormErrors(twoFactorForm);
  twoFactorForm.hidden = true;
  form.hidden = false;
  showMessage(text);
  document.getElementById('password')?.focus();
}

async function handleTwoFactor(event) {
  event.preventDefault();
  if (!twoFactorForm) return;
  clearFormErrors(twoFactorForm);
  const input = document.getElementById('twoFactorCode');
  const code = String(input?.value || '').trim();
  if (!code) {
    showFormErrors(twoFactorForm, [{ field: 'code', message: 'Enter the code from your app.' }]);
    return;
  }
  const button = twoFactorForm.querySelector('[type="submit"]');
  if (button) button.setAttribute('disabled', 'true');
  try {
    const res = await apiRequest('/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      await finishSignIn(data);
      return;
    }
    if (data.restart === true) {
      backToPasswordStep(data.error);
      return;
    }
    if (input) input.value = '';
    showFormErrors(twoFactorForm, [
      { field: 'code', message: data.error || 'That code did not work. Try again.' },
    ]);
  } catch (error) {
    showFormErrors(twoFactorForm, [{ message: 'Network error. Please try again later.' }]);
  } finally {
    if (button) button.removeAttribute('disabled');
  }
}

async function finishSignIn(user) {
  await clearUserCache();
  if (user.pushReset === true) {
    try {
      const sub = await (await getRegistration())?.pushManager?.getSubscription();
      await sub?.unsubscribe();
    } catch (_) {
      /* ignore */
    }
  }
  try {
    sessionStorage.removeItem('privacy_notice_dismissed');
  } catch (_) {
    /* ignore */
  }
  if (Number.isInteger(user.recoveryCodesLeft)) {
    showMessage(
      `Signed in with a recovery code. You have ${user.recoveryCodesLeft} left. Redirecting...`,
      'success'
    );
    setTimeout(() => redirectToDashboard(user.role), 3000);
    return;
  }
  showMessage('Login successful. Redirecting...', 'success');
  setTimeout(() => redirectToDashboard(user.role), 1000);
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
      const who = account.label || account.role || 'demo';
      btn.setAttribute('aria-label', `Fill ${who} demo login`);
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
  if (twoFactorForm) {
    twoFactorForm.addEventListener('submit', handleTwoFactor);
    document.getElementById('twoFactorCancel')?.addEventListener('click', () => backToPasswordStep());
  }
  loadDemoHints().catch(() => {});
});
