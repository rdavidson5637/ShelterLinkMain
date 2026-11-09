/**
 * Team invites (admin only): invite staff or admins by email, see who has
 * not accepted yet, and revoke an invite that should stop working.
 */
import { apiRequest } from '../config.js';
import { requireAuth, logout, isAdminRole } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { showConfirm } from '../components/confirmDialog.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';

const messageEl = document.getElementById('message');
const form = document.getElementById('inviteForm');
const emailInput = document.getElementById('email');
const roleInput = document.getElementById('role');
const inviteButton = document.getElementById('inviteButton');
const invitesBody = document.getElementById('invitesBody');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_LABELS = { staff: 'Staff', admin: 'Admin' };
const EMAIL_REASONS = {
  email_not_configured: 'email is not set up on this server',
  app_url_missing: 'APP_URL is missing or not https',
  send_failed: 'the email server refused it',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function setMessage(text, tone = 'neutral') {
  if (!text) {
    messageEl.replaceChildren();
    return;
  }
  const cls = tone === 'error' ? 'error-message' : tone === 'success' ? 'success-message' : '';
  messageEl.replaceChildren(el('p', { className: cls, textContent: text }));
}

async function errorBody(res, fallback) {
  try {
    const body = await res.json();
    return { message: body.error || fallback, field: body.field || undefined };
  } catch {
    return { message: fallback };
  }
}

function emptyRow(text) {
  invitesBody.replaceChildren(el('tr', {}, el('td', { colSpan: 5, textContent: text })));
}

function revokeButton(invite) {
  const button = el('button', { type: 'button', className: 'secondary', textContent: 'Revoke' });
  button.addEventListener('click', () => {
    showConfirm({
      heading: `Revoke the invite for ${invite.email}?`,
      body: 'The link in their email stops working. You can invite them again later.',
      confirmText: 'Revoke invite',
      cancelText: 'Keep it',
      onConfirm: async () => {
        button.disabled = true;
        const res = await apiRequest(`/admin/invites/${invite.id}/revoke`, { method: 'POST', body: {} });
        if (!res.ok) {
          setMessage((await errorBody(res, 'Could not revoke this invite')).message, 'error');
          button.disabled = false;
          return;
        }
        setMessage(`Revoked the invite for ${invite.email}.`, 'success');
        await loadInvites();
      },
    });
  });
  return button;
}

async function loadInvites() {
  try {
    const res = await apiRequest('/admin/invites', { method: 'GET' });
    if (!res.ok) {
      emptyRow((await errorBody(res, 'Could not load invites')).message);
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      emptyRow('No invites waiting. People you invite appear here until they set up their account.');
      return;
    }
    invitesBody.replaceChildren(...rows.map((invite) => el('tr', {}, [
      el('td', { textContent: invite.email }),
      el('td', { textContent: ROLE_LABELS[invite.role] || invite.role }),
      el('td', { textContent: formatDateOnly(invite.created_at) }),
      el('td', { textContent: formatDateOnly(invite.expires_at) }),
      el('td', {}, revokeButton(invite)),
    ])));
  } catch (error) {
    emptyRow(error.message || 'Could not load invites');
  }
}

async function sendInvite(email, role) {
  inviteButton.disabled = true;
  inviteButton.textContent = 'Sending…';
  try {
    const body = { email, role };
    if (role === 'admin') body.confirm_admin = true;
    const res = await apiRequest('/admin/invites', { method: 'POST', body });
    if (!res.ok) {
      const { message, field } = await errorBody(res, 'Could not send the invite');
      showFormErrors(form, [{ field, message }]);
      return;
    }
    const out = await res.json();
    if (out.inviteEmail && out.inviteEmail.sent) {
      setMessage(`Invite sent to ${out.invite.email}. The link expires ${formatDateOnly(out.invite.expiresAt)}.`, 'success');
    } else {
      const why = EMAIL_REASONS[out.inviteEmail && out.inviteEmail.reason] || 'it could not be sent';
      setMessage(`The invite was created, but the email to ${out.invite.email} was not sent because ${why}. Send it again once that is fixed.`, 'error');
    }
    form.reset();
    await loadInvites();
  } catch (error) {
    showFormErrors(form, [{ message: error.message || 'Network error. Please try again.' }]);
  } finally {
    inviteButton.disabled = false;
    inviteButton.textContent = 'Send invite';
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearFormErrors(form);
  setMessage('');
  const email = emailInput.value.trim();
  if (!EMAIL_RE.test(email)) {
    showFormErrors(form, [{ field: 'email', message: 'Enter an email address like name@example.org.' }]);
    return;
  }
  const role = roleInput.value;
  if (role !== 'admin') {
    sendInvite(email, role);
    return;
  }
  // Another admin can do everything you can, including inviting more
  // admins and changing your role. Ask first.
  showConfirm({
    heading: `Make ${email} an admin?`,
    body: 'Admins can invite other admins, change anyone\'s role (including yours) and use privacy tools. Choose Staff if they only need to run shifts.',
    confirmText: 'Invite as admin',
    cancelText: 'Go back',
    onConfirm: () => sendInvite(email, role),
  });
});

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (!isAdminRole(user)) {
    window.location.href = '/pages/admin/dashboard.html';
    return;
  }
  document.getElementById('logoutButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    logout();
  });
  await loadInvites();
}

init();
