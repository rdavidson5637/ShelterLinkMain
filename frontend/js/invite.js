/**
 * Invite accept page, served at /invite#<token>.
 *
 * The token is in the #fragment, which the browser never sends to a server.
 * This page reads it, removes it from the address bar and history at once,
 * and sends it only in POST bodies to the ShelterLink API. The email,
 * shelter and role shown here come from the server's check of the token;
 * the form never sends them back.
 */
import { apiRequest } from '/js/config.js';
import { showFormErrors, clearFormErrors } from '/js/utils/formErrors.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const form = document.getElementById('inviteForm');
const heading = document.getElementById('heading');
const intro = document.getElementById('intro');
const messageEl = document.getElementById('message');
const submitButton = document.getElementById('submitButton');
const loginLink = document.getElementById('loginLink');

export function tokenFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  let token;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return TOKEN_RE.test(token) ? token : null;
}

/** Drop the token from the address bar and this history entry. */
function forgetTokenInUrl() {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch { /* old browser: the fragment still never reaches a server */ }
}

function showMessage(text, tone = 'info') {
  const p = document.createElement('p');
  p.className = tone === 'error' ? 'error-message' : tone === 'success' ? 'success-message' : '';
  p.textContent = text;
  messageEl.replaceChildren(p);
}

function deadEnd(text) {
  heading.textContent = 'This invite link does not work';
  intro.textContent = text;
  form.hidden = true;
  loginLink.hidden = false;
}

function roleLabel(role) {
  return role === 'staff' ? 'a staff account' : 'the admin account';
}

async function checkToken(token) {
  try {
    const res = await apiRequest('/auth/invite/check', { method: 'POST', body: { token } });
    const data = await res.json().catch(() => ({ valid: false }));
    if (!data.valid) {
      deadEnd('It may have been used already or have expired. Ask the person who invited you for a new link.');
      return;
    }
    heading.textContent = `Set up ${data.shelterName || 'your shelter'} on ShelterLink`;
    intro.textContent = `You have been invited to create ${roleLabel(data.role)}. Choose a password to finish.`;
    document.getElementById('email').value = data.email || '';
    form.hidden = false;
    document.getElementById('first_name').focus();
  } catch {
    deadEnd('We could not check this link just now. Please try again in a moment.');
  }
}

function setBusy(busy) {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? 'Creating your account…' : 'Create my account';
}

async function submit(token, event) {
  event.preventDefault();
  clearFormErrors(form);
  messageEl.replaceChildren();

  const firstName = document.getElementById('first_name').value.trim();
  const lastName = document.getElementById('last_name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm_password').value;
  const privacy = document.getElementById('privacy_notice').checked;

  const errors = [];
  if (!firstName) errors.push({ field: 'first_name', message: 'Enter your first name.' });
  if (!lastName) errors.push({ field: 'last_name', message: 'Enter your last name.' });
  if (password.length < 10) errors.push({ field: 'password', message: 'Use at least 10 characters.' });
  if (password !== confirm) errors.push({ field: 'confirm_password', message: 'Passwords do not match.' });
  if (!privacy) errors.push({ field: 'privacy_notice', message: 'Please confirm you have read the privacy notice.' });
  if (errors.length) {
    showFormErrors(form, errors);
    return;
  }

  setBusy(true);
  try {
    const res = await apiRequest('/auth/accept-invite', {
      method: 'POST',
      body: {
        token,
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
        password,
        privacy_notice: true,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      form.hidden = true;
      heading.textContent = 'Your account is ready';
      intro.textContent = `Sign in with ${data.email || 'your email address'} and the password you just chose.`;
      loginLink.hidden = false;
      showMessage(data.message || 'Your account is ready.', 'success');
      return;
    }
    if (res.status === 400 && /invite link/i.test(String(data.error || ''))) {
      deadEnd(data.error);
      return;
    }
    const field = /password/i.test(String(data.error || '')) ? 'password' : undefined;
    showFormErrors(form, [{ field, message: data.error || 'Something went wrong. Please try again.' }]);
    setBusy(false);
  } catch {
    showFormErrors(form, [{ message: 'Network error. Please check your connection and try again.' }]);
    setBusy(false);
  }
}

const token = tokenFromHash(window.location.hash);
forgetTokenInUrl();
if (!token) {
  deadEnd('The link is incomplete. Open it straight from the invite email (reloading this page will not work), or ask for a new one.');
} else {
  form.addEventListener('submit', (event) => submit(token, event));
  checkToken(token);
}
