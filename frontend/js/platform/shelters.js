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

function applicantCell(app) {
  const mail = el('a', { href: `mailto:${app.contact_email}`, textContent: app.contact_email });
  return el('td', {}, [el('div', { textContent: app.contact_name || '' }), el('div', {}, mail)]);
}

async function approve(app, button) {
  showConfirm({
    heading: `Approve ${app.shelter_name}?`,
    body: `This creates the shelter at /s/${app.desired_slug} and an admin invite for ${app.contact_email}.`,
    confirmText: 'Approve',
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
        setMessage(
          `Approved. ${out.shelter.name} is live at /s/${out.shelter.slug}. `
          + `Admin invite for ${out.invite.email} expires ${formatDateOnly(out.invite.expiresAt)}. `
          + 'Invite emails are not sent yet; see docs/platform-owner.md for the staging link.',
          'success'
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

function decisionCell(app) {
  if (app.status !== 'pending') {
    const bits = [];
    if (app.decided_at) bits.push(el('div', { textContent: `Decided ${formatDateOnly(app.decided_at)}` }));
    if (app.reason) bits.push(el('div', { textContent: `Reason: ${app.reason}` }));
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

async function loadShelters() {
  try {
    const res = await apiRequest('/platform/shelters', { method: 'GET' });
    if (!res.ok) {
      rowMessage(sheltersBody, 5, await errorText(res, 'Could not load shelters'));
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      rowMessage(sheltersBody, 5, 'No shelters');
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
    ])));
  } catch (error) {
    rowMessage(sheltersBody, 5, error.message || 'Could not load shelters');
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
