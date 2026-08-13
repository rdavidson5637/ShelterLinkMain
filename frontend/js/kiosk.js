const unlockPanel = document.getElementById('unlockPanel');
const shiftsPanel = document.getElementById('shiftsPanel');
const checkPanel = document.getElementById('checkPanel');
const unlockForm = document.getElementById('unlockForm');
const shiftsList = document.getElementById('shiftsList');
const messageEl = document.getElementById('message');
const lockButton = document.getElementById('lockButton');
const backToShifts = document.getElementById('backToShifts');
const codeForm = document.getElementById('codeForm');
const checkCode = document.getElementById('checkCode');
const selectedVolunteerName = document.getElementById('selectedVolunteerName');
const selectedShiftTitle = document.getElementById('selectedShiftTitle');
const checkActionHint = document.getElementById('checkActionHint');
const submitCheck = document.getElementById('submitCheck');
const clockLabel = document.getElementById('clockLabel');

const AUTO_RESET_MS = 10000;
let selected = null;
let resetTimer = null;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function show(panel) {
  unlockPanel?.classList.toggle('hidden', panel !== 'unlock');
  shiftsPanel?.classList.toggle('hidden', panel !== 'shifts');
  checkPanel?.classList.toggle('hidden', panel !== 'check');
  lockButton?.classList.toggle('hidden', panel === 'unlock');
}

function clearResetTimer() {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
}

function scheduleReset() {
  clearResetTimer();
  resetTimer = setTimeout(() => {
    selected = null;
    setMessage('');
    if (checkCode) checkCode.value = '';
    show('shifts');
    loadShifts();
  }, AUTO_RESET_MS);
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function api(path, options = {}) {
  const res = await fetch(`/api/kiosk${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function ensureUnlocked() {
  const { res, body } = await api('/status', { method: 'GET' });
  if (res.ok && body.kiosk) {
    show('shifts');
    await loadShifts();
    return true;
  }
  show('unlock');
  return false;
}

async function unlock(event) {
  event.preventDefault();
  setMessage('');
  const email = document.getElementById('unlockEmail').value.trim();
  const password = document.getElementById('unlockPassword').value;
  const { res, body } = await api('/unlock', {
    method: 'POST',
    body: { email, password },
  });
  if (!res.ok) {
    setMessage(body.error || 'Unable to unlock', 'error');
    return;
  }
  unlockForm?.reset();
  show('shifts');
  await loadShifts();
}

async function loadShifts() {
  if (!shiftsList) return;
  const { res, body } = await api('/shifts/today', { method: 'GET' });
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      show('unlock');
      setMessage('Kiosk locked. Staff must unlock again.', 'error');
      return;
    }
    shiftsList.innerHTML = `<p class="error">${body.error || 'Unable to load shifts'}</p>`;
    return;
  }

  const shifts = Array.isArray(body) ? body : [];
  if (!shifts.length) {
    shiftsList.innerHTML = '<p class="muted">No shifts scheduled for today.</p>';
    return;
  }

  shiftsList.innerHTML = '';
  shifts.forEach((shift) => {
    const article = document.createElement('article');
    article.className = 'shift-card';
    article.innerHTML = `
      <h2>${shift.title || 'Shift'}</h2>
      <p class="muted">${formatTime(shift.start_date)}${shift.location ? ` · ${shift.location}` : ''}</p>
      <div class="volunteer-grid"></div>
    `;
    const grid = article.querySelector('.volunteer-grid');
    if (!shift.volunteers?.length) {
      grid.innerHTML = '<p class="muted">No accepted volunteers</p>';
    } else {
      shift.volunteers.forEach((vol) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'volunteer-btn';
        btn.dataset.state = vol.state || 'ready';
        btn.textContent = vol.display_name;
        btn.addEventListener('click', () => openCheck(shift, vol));
        grid.appendChild(btn);
      });
    }
    shiftsList.appendChild(article);
  });
}

function openCheck(shift, volunteer) {
  clearResetTimer();
  selected = { shift, volunteer };
  if (selectedVolunteerName) selectedVolunteerName.textContent = volunteer.display_name;
  if (selectedShiftTitle) {
    selectedShiftTitle.textContent = `${shift.title || 'Shift'} · ${formatTime(shift.start_date)}`;
  }
  const action = volunteer.state === 'checked_in' ? 'check out' : 'check in';
  if (checkActionHint) {
    checkActionHint.textContent =
      volunteer.state === 'checked_out'
        ? 'Already checked out for this shift.'
        : `Enter the shift code to ${action}.`;
  }
  if (submitCheck) {
    submitCheck.disabled = volunteer.state === 'checked_out';
    submitCheck.textContent = volunteer.state === 'checked_in' ? 'Check out' : 'Check in';
  }
  if (checkCode) {
    checkCode.value = '';
    checkCode.focus();
  }
  setMessage('');
  show('check');
  scheduleReset();
}

async function submitCode(event) {
  event.preventDefault();
  if (!selected || selected.volunteer.state === 'checked_out') return;
  clearResetTimer();
  setMessage('');
  const code = checkCode?.value?.trim() || '';
  const path =
    selected.volunteer.state === 'checked_in'
      ? `/applications/${selected.volunteer.application_id}/check-out`
      : `/applications/${selected.volunteer.application_id}/check-in`;

  const { res, body } = await api(path, { method: 'POST', body: { code } });
  if (!res.ok) {
    setMessage(body.error || 'Check failed', 'error');
    scheduleReset();
    return;
  }
  setMessage(
    selected.volunteer.state === 'checked_in' ? 'Checked out. Thank you!' : 'Checked in. Welcome!',
    'success'
  );
  scheduleReset();
}

async function lockKiosk() {
  clearResetTimer();
  await api('/lock', { method: 'POST' });
  selected = null;
  setMessage('Kiosk locked.', 'success');
  show('unlock');
}

function tickClock() {
  if (!clockLabel) return;
  clockLabel.textContent = new Date().toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  tickClock();
  setInterval(tickClock, 30000);
  unlockForm?.addEventListener('submit', unlock);
  codeForm?.addEventListener('submit', submitCode);
  backToShifts?.addEventListener('click', () => {
    clearResetTimer();
    selected = null;
    setMessage('');
    show('shifts');
    loadShifts();
  });
  lockButton?.addEventListener('click', lockKiosk);
  checkCode?.addEventListener('input', () => {
    if (selected) scheduleReset();
  });
  await ensureUnlocked();
  setInterval(() => {
    if (!shiftsPanel?.classList.contains('hidden')) loadShifts();
  }, 60000);
});
