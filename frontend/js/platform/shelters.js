/**
 * Platform owner queue: shelter applications and the shelter list.
 * The page itself is served only to platform owners (server.js); every
 * /api/platform call is gated again on the server.
 */
import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { showConfirm } from '../components/confirmDialog.js';

const REASON_MIN = 3;
const REASON_MAX = 1000;

const REGULATOR_LABELS = {
  ccew: 'Charity Commission (England and Wales)',
  ccni: 'Charity Commission for Northern Ireland',
  oscr: 'OSCR (Scotland)',
  cri: 'Charities Regulator (Ireland)',
};

const REGISTER_LABELS = {
  registered: 'On the register',
  removed: 'Removed from the register',
  not_found: 'Not on the register',
  unavailable: 'Register lookup failed',
  not_configured: 'No register lookup for this regulator yet',
  invalid_format: 'Charity number is not a valid format',
};

const INVITE_EMAIL_REASONS = {
  email_not_configured: 'email is not set up on this server',
  app_url_missing: 'APP_URL is missing or not https',
  send_failed: 'the email server refused it',
};

/** One sentence on whether the invite email went, for the status line. */
export function inviteEmailSentence(inviteEmail, email) {
  if (inviteEmail && inviteEmail.sent) return `Invite emailed to ${email}.`;
  const why = INVITE_EMAIL_REASONS[inviteEmail && inviteEmail.reason] || 'it could not be sent';
  return `The invite email to ${email} was not sent because ${why}. Use Resend invite once that is fixed.`;
}

const messageEl = document.getElementById('message');
const applicationsBody = document.getElementById('applicationsBody');
const sheltersBody = document.getElementById('sheltersBody');
const statusFilter = document.getElementById('statusFilter');

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
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.replaceChildren(el('p', { className: cls, textContent: text }));
}

function rowMessage(tbody, colspan, text) {
  tbody.replaceChildren(el('tr', {}, el('td', { colSpan: colspan, textContent: text })));
}

async function errorText(res, fallback) {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
    if (body && typeof body.message === 'string') return body.message;
  } catch { /* not json */ }
  return fallback;
}

function registerCell(app) {
  const snap = app.register_snapshot;
  const regulator = REGULATOR_LABELS[app.regulator] || app.regulator || 'Unknown regulator';
  const lines = [el('div', { textContent: `${regulator}, no. ${app.charity_number || '?'}` })];
  if (!snap) {
    lines.push(el('div', { className: 'muted', textContent: 'No register check saved' }));
    return el('td', {}, lines);
  }
  const verdict = REGISTER_LABELS[snap.status] || snap.status || 'Unknown';
  lines.push(el('strong', { textContent: verdict }));
  if (snap.name) {
    const nameDiffers = snap.name.trim().toLowerCase() !== String(app.shelter_name || '').trim().toLowerCase();
    lines.push(el('div', { textContent: `Register name: ${snap.name}${nameDiffers ? ' (differs from applied name)' : ''}` }));
  }
  if (snap.removedAt) lines.push(el('div', { textContent: `Removed ${formatDateOnly(snap.removedAt)}` }));
  if (snap.message) lines.push(el('div', { className: 'muted', textContent: snap.message }));
  if (snap.checkedAt) lines.push(el('div', { className: 'muted', textContent: `Checked ${formatDateOnly(snap.checkedAt)}` }));
  return el('td', {}, lines);
}

export const EXISTING_ACCOUNT_WARNING = 'This email already has a ShelterLink account, so the invite cannot be accepted with it.';

function applicantCell(app) {
  const mail = el('a', { href: `mailto:${app.contact_email}`, textContent: app.contact_email });
  const bits = [el('div', { textContent: app.contact_name || '' }), el('div', {}, mail)];
  if (app.status === 'pending' && app.contact_has_account) {
    bits.push(el('div', { className: 'error', textContent: EXISTING_ACCOUNT_WARNING }));
  }
  return el('td', {}, bits);
}

/** Body text for the Approve confirmation. */
export function approveConfirmBody(app) {
  const base = `This creates the shelter at /s/${app.desired_slug} and an admin invite for ${app.contact_email}.`;
  if (!app.contact_has_account) return base;
  return `${base} Warning: ${EXISTING_ACCOUNT_WARNING} Ask the applicant for a different address first, or approve and sort it out with them.`;
}

async function approve(app, button) {
  showConfirm({
    heading: `Approve ${app.shelter_name}?`,
    body: approveConfirmBody(app),
    confirmText: app.contact_has_account ? 'Approve anyway' : 'Approve',
    cancelText: 'Not yet',
    onConfirm: async () => {
      button.disabled = true;
      try {
        const res = await apiRequest(`/platform/applications/${app.id}/approve`, { method: 'POST', body: {} });
        if (!res.ok) {
          setMessage(await errorText(res, 'Could not approve this application'), 'error');
          button.disabled = false;
          return;
        }
        const out = await res.json();
        const sent = Boolean(out.inviteEmail && out.inviteEmail.sent);
        setMessage(
          `Approved. ${out.shelter.name} is live at /s/${out.shelter.slug}. `
          + `${inviteEmailSentence(out.inviteEmail, out.invite.email)} `
          + `The link expires ${formatDateOnly(out.invite.expiresAt)}.`,
          sent ? 'success' : 'error'
        );
        await Promise.all([loadApplications(), loadShelters()]);
      } catch (error) {
        setMessage(error.message || 'Could not approve this application', 'error');
        button.disabled = false;
      }
    },
  });
}

function rejectForm(app) {
  const id = `reason-${app.id}`;
  const textarea = el('textarea', {
    id,
    name: 'reason',
    rows: 2,
    required: true,
    minLength: REASON_MIN,
    maxLength: REASON_MAX,
  });
  const submit = el('button', { type: 'submit', className: 'secondary', textContent: 'Reject' });
  const form = el('form', {}, [
    el('label', { htmlFor: id, textContent: 'Reason (kept on record)' }),
    textarea,
    submit,
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const reason = textarea.value.trim();
    if (reason.length < REASON_MIN) {
      setMessage(`Give a reason of at least ${REASON_MIN} characters`, 'error');
      textarea.focus();
      return;
    }
    submit.disabled = true;
    try {
      const res = await apiRequest(`/platform/applications/${app.id}/reject`, { method: 'POST', body: { reason } });
      if (!res.ok) {
        setMessage(await errorText(res, 'Could not reject this application'), 'error');
        submit.disabled = false;
        return;
      }
      setMessage(`Rejected ${app.shelter_name}.`, 'success');
      await loadApplications();
    } catch (error) {
      setMessage(error.message || 'Could not reject this application', 'error');
      submit.disabled = false;
    }
  });
  return el('details', {}, [el('summary', { textContent: 'Reject...' }), form]);
}

async function resend(app, button) {
  showConfirm({
    heading: `Resend the invite for ${app.shelter_name}?`,
    body: `The old link stops working and a new one is emailed to ${app.contact_email}.`,
    confirmText: 'Resend',
    cancelText: 'Cancel',
    onConfirm: async () => {
      button.disabled = true;
      try {
        const res = await apiRequest(`/platform/applications/${app.id}/resend-invite`, { method: 'POST', body: {} });
        if (!res.ok) {
          setMessage(await errorText(res, 'Could not resend the invite'), 'error');
          button.disabled = false;
          return;
        }
        const out = await res.json();
        const sent = Boolean(out.inviteEmail && out.inviteEmail.sent);
        setMessage(
          `${inviteEmailSentence(out.inviteEmail, out.invite.email)} `
          + `The new link expires ${formatDateOnly(out.invite.expiresAt)}.`,
          sent ? 'success' : 'error'
        );
        button.disabled = false;
      } catch (error) {
        setMessage(error.message || 'Could not resend the invite', 'error');
        button.disabled = false;
      }
    },
  });
}

function decisionCell(app) {
  if (app.status !== 'pending') {
    const bits = [];
    if (app.decided_at) bits.push(el('div', { textContent: `Decided ${formatDateOnly(app.decided_at)}` }));
    if (app.reason) bits.push(el('div', { textContent: `Reason: ${app.reason}` }));
    if (app.status === 'approved' && app.invite_accepted) {
      bits.push(el('div', { textContent: 'Invite accepted' }));
    } else if (app.status === 'approved') {
      const resendButton = el('button', { type: 'button', className: 'secondary', textContent: 'Resend invite' });
      resendButton.addEventListener('click', () => resend(app, resendButton));
      bits.push(resendButton);
    }
    return el('td', {}, bits);
  }
  const approveButton = el('button', { type: 'button', textContent: 'Approve' });
  approveButton.addEventListener('click', () => approve(app, approveButton));
  return el('td', {}, [approveButton, rejectForm(app)]);
}

async function loadApplications() {
  const status = statusFilter.value || 'pending';
  try {
    const res = await apiRequest(`/platform/applications?status=${encodeURIComponent(status)}`, { method: 'GET' });
    if (!res.ok) {
      rowMessage(applicationsBody, 7, await errorText(res, 'Could not load applications'));
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      rowMessage(applicationsBody, 7, status === 'pending' ? 'No applications waiting' : 'No applications');
      return;
    }
    applicationsBody.replaceChildren(...rows.map((app) => el('tr', {}, [
      el('td', { textContent: app.shelter_name }),
      el('td', {}, el('code', { textContent: app.desired_slug })),
      applicantCell(app),
      registerCell(app),
      el('td', { textContent: formatDateOnly(app.created_at) }),
      el('td', {}, createStatusBadge(app.status)),
      decisionCell(app),
    ])));
  } catch (error) {
    rowMessage(applicationsBody, 7, error.message || 'Could not load applications');
  }
}

function suspendForm(shelter) {
  const id = `suspend-${shelter.id}`;
  const textarea = el('textarea', { id, name: 'reason', rows: 2, maxLength: REASON_MAX });
  const submit = el('button', { type: 'submit', className: 'secondary', textContent: 'Suspend shelter' });
  const form = el('form', {}, [
    el('p', {
      className: 'muted',
      textContent: 'Its people are signed out and cannot sign in, its public pages and feeds go offline, '
        + 'and reminder emails stop. Nothing is deleted.',
    }),
    el('label', { htmlFor: id, textContent: 'Reason (optional, kept on record)' }),
    textarea,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showConfirm({
      heading: `Suspend ${shelter.name}?`,
      body: `Everyone at ${shelter.name} is signed out and /s/${shelter.slug} stops working until it is reactivated.`,
      confirmText: 'Suspend',
      cancelText: 'Cancel',
      onConfirm: async () => {
        submit.disabled = true;
        try {
          const reason = textarea.value.trim();
          const res = await apiRequest(`/platform/shelters/${shelter.id}/suspend`, {
            method: 'POST',
            body: reason ? { reason } : {},
          });
          if (!res.ok) {
            setMessage(await errorText(res, 'Could not suspend this shelter'), 'error');
            submit.disabled = false;
            return;
          }
          setMessage(`Suspended ${shelter.name}.`, 'success');
          await loadShelters();
        } catch (error) {
          setMessage(error.message || 'Could not suspend this shelter', 'error');
          submit.disabled = false;
        }
      },
    });
  });
  return el('details', {}, [el('summary', { textContent: 'Suspend...' }), form]);
}

function reactivateButton(shelter) {
  const button = el('button', { type: 'button', className: 'secondary', textContent: 'Reactivate' });
  button.addEventListener('click', () => {
    showConfirm({
      heading: `Reactivate ${shelter.name}?`,
      body: `Its people can sign in again, /s/${shelter.slug} comes back online, and reminder emails restart.`,
      confirmText: 'Reactivate',
      cancelText: 'Cancel',
      onConfirm: async () => {
        button.disabled = true;
        try {
          const res = await apiRequest(`/platform/shelters/${shelter.id}/reactivate`, { method: 'POST', body: {} });
          if (!res.ok) {
            setMessage(await errorText(res, 'Could not reactivate this shelter'), 'error');
            button.disabled = false;
            return;
          }
          setMessage(`Reactivated ${shelter.name}.`, 'success');
          await loadShelters();
        } catch (error) {
          setMessage(error.message || 'Could not reactivate this shelter', 'error');
          button.disabled = false;
        }
      },
    });
  });
  return button;
}

async function loadShelters() {
  try {
    const res = await apiRequest('/platform/shelters', { method: 'GET' });
    if (!res.ok) {
      rowMessage(sheltersBody, 6, await errorText(res, 'Could not load shelters'));
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      rowMessage(sheltersBody, 6, 'No shelters');
      return;
    }
    sheltersBody.replaceChildren(...rows.map((s) => el('tr', {}, [
      el('td', { textContent: s.name }),
      el('td', {}, el('code', { textContent: s.slug })),
      el('td', {
        textContent: s.charity_number
          ? `${(s.charity_regulator || '').toUpperCase()} ${s.charity_number}`
          : '',
      }),
      el('td', {}, createStatusBadge(s.status)),
      el('td', { textContent: formatDateOnly(s.created_at) }),
      el('td', {}, s.status === 'active' ? suspendForm(s) : reactivateButton(s)),
    ])));
  } catch (error) {
    rowMessage(sheltersBody, 6, error.message || 'Could not load shelters');
  }
}

async function init() {
  await requireAuth();
  document.getElementById('logoutButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    logout();
  });
  statusFilter.addEventListener('change', () => {
    setMessage('');
    loadApplications();
  });
  await Promise.all([loadApplications(), loadShelters()]);
}

document.addEventListener('DOMContentLoaded', init);
