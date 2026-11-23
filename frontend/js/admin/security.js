import { apiRequest } from '../config.js';
import { requireAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { mountSignedInDevices, mountChangePassword } from '../components/signedInDevices.js';

const $ = (id) => document.getElementById(id);
const messageEl = $('message');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.replaceChildren();
    return;
  }
  const note = document.createElement('p');
  if (tone === 'error') note.className = 'error';
  if (tone === 'success') note.className = 'success';
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function groupKey(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

function renderStatus(state) {
  const text = $('statusText');
  const start = $('startSetupBtn');
  $('setupSection').hidden = true;
  $('disableSection').hidden = !state.enabled;
  start.hidden = state.enabled;
  if (state.enabled) {
    const left = Number(state.recoveryCodesLeft) || 0;
    text.textContent = `On. You will be asked for a code from your app each time you sign in. Recovery codes left: ${left}.`;
  } else {
    text.textContent = 'Off. You sign in with your email and password only.';
  }
}

async function loadStatus() {
  const res = await apiRequest('/auth/2fa', { method: 'GET' });
  const data = await readJson(res);
  if (!res.ok) {
    $('statusText').textContent = data.error || 'Could not load your sign-in settings.';
    $('startSetupBtn').hidden = true;
    return;
  }
  renderStatus(data);
}

async function onPassword(event) {
  event.preventDefault();
  setMessage('');
  const password = $('setupPassword').value;
  const res = await apiRequest('/auth/2fa/setup', { method: 'POST', body: { password } });
  const data = await readJson(res);
  $('setupPassword').value = '';
  if (!res.ok) {
    setMessage(data.error || 'Could not start setup.', 'error');
    return;
  }
  $('secretText').textContent = groupKey(data.secret);
  $('otpauthLink').href = data.otpauthUri;
  $('passwordForm').hidden = true;
  $('enableForm').hidden = false;
  $('enableCode').focus();
}

async function onEnable(event) {
  event.preventDefault();
  setMessage('');
  const code = $('enableCode').value.trim();
  const res = await apiRequest('/auth/2fa/enable', { method: 'POST', body: { code } });
  const data = await readJson(res);
  if (!res.ok) {
    setMessage(data.error || 'That code did not work.', 'error');
    return;
  }
  $('enableForm').reset();
  $('secretText').textContent = '';
  $('setupSection').hidden = true;
  const list = $('recoveryList');
  list.replaceChildren(
    ...(data.recoveryCodes || []).map((c) => {
      const li = document.createElement('li');
      const codeEl = document.createElement('code');
      codeEl.textContent = c;
      li.appendChild(codeEl);
      return li;
    })
  );
  $('recoverySection').hidden = false;
  $('statusText').textContent = 'On. Save your recovery codes below.';
  $('startSetupBtn').hidden = true;
}

async function onDisable(event) {
  event.preventDefault();
  setMessage('');
  const password = $('disablePassword').value;
  const code = $('disableCode').value.trim();
  const res = await apiRequest('/auth/2fa/disable', { method: 'POST', body: { password, code } });
  const data = await readJson(res);
  $('disableForm').reset();
  if (!res.ok) {
    setMessage(data.error || 'Could not turn off two-factor sign-in.', 'error');
    return;
  }
  setMessage('Two-factor sign-in is off.', 'success');
  await loadStatus();
}

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  $('logoutButton')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
  $('startSetupBtn').addEventListener('click', () => {
    setMessage('');
    $('setupSection').hidden = false;
    $('passwordForm').hidden = false;
    $('enableForm').hidden = true;
    $('startSetupBtn').hidden = true;
    $('setupPassword').focus();
  });
  $('passwordForm').addEventListener('submit', (e) => onPassword(e).catch(() => setMessage('Network error. Please try again.', 'error')));
  $('enableForm').addEventListener('submit', (e) => onEnable(e).catch(() => setMessage('Network error. Please try again.', 'error')));
  $('disableForm').addEventListener('submit', (e) => onDisable(e).catch(() => setMessage('Network error. Please try again.', 'error')));
  $('recoveryDoneBtn').addEventListener('click', () => {
    $('recoveryList').replaceChildren();
    $('recoverySection').hidden = true;
    loadStatus().catch(() => {});
  });
  mountChangePassword($('changePassword'));
  await Promise.all([loadStatus(), mountSignedInDevices($('signedInDevices'))]);
}

init().catch(() => setMessage('Could not load this page. Please refresh.', 'error'));
