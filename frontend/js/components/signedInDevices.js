// Signed-in devices and password change (SL-LATER-33).
// Lists the caller's own sessions from /api/auth/sessions as ruled table
// rows. Row ids are opaque handles from the server, never session ids.
import { apiRequest } from '../config.js';
import { showConfirm } from './confirmDialog.js';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function when(iso) {
  if (!iso) return 'Not recorded';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not recorded';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} minutes ago`;
  return dateFmt.format(d);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else node.setAttribute(k, v);
  });
  children.forEach((c) => c && node.append(c));
  return node;
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

function say(statusEl, text, tone) {
  statusEl.className = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  statusEl.textContent = text || '';
}

export async function mountSignedInDevices(container) {
  if (!container) return;
  const heading = el('h2', { id: 'devicesTitle', text: 'Signed-in devices' });
  const intro = el('p', {
    className: 'devices-intro',
    text: 'Browsers signed in to your account. Sign out any you do not recognise, then change your password.',
  });
  const status = el('p', { role: 'status', 'aria-live': 'polite' });
  const tbody = el('tbody');
  const table = el('table', { className: 'devices-table' }, [
    el('caption', { className: 'visually-hidden', text: 'Your signed-in devices' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Device' }),
        el('th', { scope: 'col', text: 'Signed in' }),
        el('th', { scope: 'col', text: 'Last active' }),
        el('th', { scope: 'col' }, [el('span', { className: 'visually-hidden', text: 'Action' })]),
      ]),
    ]),
    tbody,
  ]);
  const othersBtn = el('button', { type: 'button', className: 'secondary', text: 'Sign out all other devices' });
  othersBtn.hidden = true;

  container.setAttribute('aria-labelledby', 'devicesTitle');
  container.replaceChildren(heading, intro, el('div', { className: 'table-wrapper' }, [table]), el('p', {}, [othersBtn]), status);

  async function revoke(id) {
    const res = await apiRequest(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const body = await readJson(res);
    if (!res.ok) return say(status, body.error || 'Could not sign out that device.', 'error');
    say(status, 'That device is signed out.', 'success');
    return load();
  }

  async function revokeOthers() {
    const res = await apiRequest('/auth/sessions/revoke-others', { method: 'POST', body: {} });
    const body = await readJson(res);
    if (!res.ok) return say(status, body.error || 'Could not sign out other devices.', 'error');
    say(status, 'All other devices are signed out.', 'success');
    return load();
  }

  function render(sessions) {
    tbody.replaceChildren(
      ...sessions.map((s) => {
        const device = el('td', {}, [el('strong', { text: s.device })]);
        if (s.kiosk) device.append(' ', el('small', { text: '(kiosk)' }));
        let action;
        if (s.current) {
          action = el('td', { className: 'devices-current', text: 'This device' });
        } else {
          const btn = el('button', { type: 'button', className: 'secondary outline devices-signout', text: 'Sign out' });
          btn.setAttribute('aria-label', `Sign out ${s.device}, last active ${when(s.lastActiveAt)}`);
          btn.addEventListener('click', () => revoke(s.id));
          action = el('td', {}, [btn]);
        }
        return el('tr', s.current ? { 'aria-current': 'true' } : {}, [
          device,
          el('td', { 'data-label': 'Signed in', text: when(s.signedInAt) }),
          el('td', { 'data-label': 'Last active', text: s.current ? 'Now' : when(s.lastActiveAt) }),
          action,
        ]);
      })
    );
    othersBtn.hidden = !sessions.some((s) => !s.current);
  }

  async function load() {
    try {
      const res = await apiRequest('/auth/sessions');
      const body = await readJson(res);
      if (!res.ok) return say(status, body.error || 'Could not load your devices.', 'error');
      return render(Array.isArray(body.sessions) ? body.sessions : []);
    } catch (error) {
      return say(status, error.message || 'Could not load your devices.', 'error');
    }
  }

  othersBtn.addEventListener('click', () => {
    showConfirm({
      heading: 'Sign out all other devices?',
      body: 'Every other browser signed in to your account will need your password again. This device stays signed in.',
      confirmText: 'Sign out other devices',
      cancelText: 'Keep them',
      onConfirm: () => revokeOthers(),
    });
  });

  document.addEventListener('sessions:changed', () => load());
  await load();
}

export function mountChangePassword(container) {
  if (!container) return;
  const status = el('p', { role: 'status', 'aria-live': 'polite' });
  const current = el('input', { type: 'password', id: 'currentPassword', name: 'currentPassword', autocomplete: 'current-password', required: '' });
  const next = el('input', { type: 'password', id: 'newPassword', name: 'newPassword', autocomplete: 'new-password', minlength: '10', required: '' });
  const submit = el('button', { type: 'submit', text: 'Change password' });
  const form = el('form', { className: 'change-password' }, [
    el('label', { for: 'currentPassword' }, ['Current password', current]),
    el('label', { for: 'newPassword' }, ['New password', el('small', { text: 'At least 10 characters.' }), next]),
    submit,
  ]);
  container.setAttribute('aria-labelledby', 'changePasswordTitle');
  container.replaceChildren(
    el('h2', { id: 'changePasswordTitle', text: 'Change password' }),
    el('p', { text: 'Changing your password signs out every other device.' }),
    form,
    status
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const res = await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current.value, newPassword: next.value },
      });
      const body = await readJson(res);
      if (!res.ok) {
        say(status, body.error || 'Could not change your password.', 'error');
        return;
      }
      form.reset();
      say(status, body.message || 'Password changed.', 'success');
      document.dispatchEvent(new CustomEvent('sessions:changed'));
    } catch (error) {
      say(status, error.message || 'Could not change your password.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
}
