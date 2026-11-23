import { apiRequest } from '../config.js';
import { checkAuth, logout, redirectIfPendingWaivers } from '../auth.js';
import { formatShiftWhen, formatTimeLabel, parseShiftDate } from '../utils/dateFormat.js';
import {
  savePendingCheckin,
  takePendingCheckin,
  cleanShift,
  cleanCode,
} from '../utils/pendingCheckin.js';

const messageEl = document.getElementById('message');
const shiftEl = document.getElementById('checkinShift');
const titleEl = document.getElementById('shiftTitle');
const whenEl = document.getElementById('shiftWhen');
const whereEl = document.getElementById('shiftWhere');
const stateEl = document.getElementById('shiftState');
const formEl = document.getElementById('checkinForm');
const codeInput = document.getElementById('checkinCode');
const codeLabel = document.getElementById('checkinCodeLabel');
const buttonEl = document.getElementById('checkinButton');

let shiftId = null;
let action = 'check-in';

function setMessage(text, type = 'error') {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.className = text ? (type === 'success' ? 'success-message' : 'error-message') : '';
}

function readScan() {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const scanned = { shift: cleanShift(params.get('shift')), code: cleanCode(hash.get('code')) };
  if (window.location.hash) {
    // Keep the code out of history and anything copied from the address bar.
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  const pending = takePendingCheckin();
  if (pending && (!scanned.shift || pending.shift === scanned.shift)) {
    return { shift: pending.shift, code: scanned.code || pending.code };
  }
  return scanned;
}

function timeOf(value) {
  const d = parseShiftDate(value);
  return d ? formatTimeLabel(d) : '';
}

function render(status) {
  shiftEl.hidden = false;
  titleEl.textContent = status.title || 'Shift';
  whenEl.textContent = formatShiftWhen(status.start_date, status.end_date);
  whereEl.textContent = status.location || '';
  formEl.hidden = true;

  if (status.state === 'not_booked') {
    stateEl.textContent = 'You do not have a confirmed place on this shift.';
    return;
  }
  if (status.state === 'checked_out') {
    stateEl.textContent = `Checked out at ${timeOf(status.checked_out_at)}. Your hours are recorded. Thank you.`;
    return;
  }
  if (!status.within_window) {
    stateEl.textContent =
      status.state === 'checked_in'
        ? 'Check-out has closed for this shift. Ask a member of staff to record your hours.'
        : 'Check-in opens one hour before the shift starts and closes at the end of the shift day.';
    return;
  }

  if (status.state === 'checked_in') {
    stateEl.textContent = `Checked in at ${timeOf(status.checked_in_at)}.`;
    action = 'check-out';
    buttonEl.textContent = 'Check out';
  } else {
    stateEl.textContent = 'You are booked on this shift.';
    action = 'check-in';
    buttonEl.textContent = 'Check in';
  }
  // A code from the poster scan is filled in silently; typed entry stays available.
  codeLabel.hidden = Boolean(codeInput.value);
  formEl.hidden = false;
}

async function loadStatus() {
  const res = await apiRequest(`/checkin/shifts/${shiftId}`, { method: 'GET' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage(body.error || 'Could not load this shift.');
    return;
  }
  render(body);
}

async function submit(event) {
  event.preventDefault();
  const code = cleanCode(codeInput.value);
  if (!code) {
    codeLabel.hidden = false;
    setMessage('Enter the check-in code printed on the poster.');
    codeInput.focus();
    return;
  }
  buttonEl.disabled = true;
  buttonEl.setAttribute('aria-busy', 'true');
  try {
    const res = await apiRequest(`/checkin/shifts/${shiftId}/${action}`, {
      method: 'POST',
      body: { code },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      codeLabel.hidden = false;
      setMessage(body.error || 'That did not work. Try again.');
      return;
    }
    setMessage(action === 'check-in' ? 'You are checked in.' : 'You are checked out.', 'success');
    await loadStatus();
  } catch (error) {
    setMessage(error.message || 'Network error. Try again.');
  } finally {
    buttonEl.disabled = false;
    buttonEl.removeAttribute('aria-busy');
  }
}

async function init() {
  document.getElementById('logoutButton')?.addEventListener('click', () => logout());
  const scan = readScan();
  shiftId = scan.shift;
  if (!shiftId) {
    setMessage('This check-in link is incomplete. Scan the poster again.');
    return;
  }
  codeInput.value = scan.code;

  const user = await checkAuth();
  if (!user) {
    savePendingCheckin(scan.shift, scan.code);
    window.location.href = '/login.html';
    return;
  }
  if (user.role !== 'volunteer') {
    setMessage('Poster check-in is for volunteers. Sign in with a volunteer account on your own phone.');
    return;
  }
  savePendingCheckin(scan.shift, scan.code);
  if (await redirectIfPendingWaivers()) return;
  takePendingCheckin();

  formEl.addEventListener('submit', submit);
  await loadStatus();
}

init();
