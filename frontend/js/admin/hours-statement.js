import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import {
  defaultStatementRange,
  renderStatementSheet,
} from '../hoursStatementShared.js';

const messageEl = document.getElementById('message');
const rangeForm = document.getElementById('rangeForm');
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const printButton = document.getElementById('printButton');
const logoutButton = document.getElementById('logoutButton');
const sheet = document.getElementById('statementSheet');
const introText = document.getElementById('introText');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const css = type === 'error' ? 'error' : 'success';
  messageEl.innerHTML = `<p class="${css}">${escapeHtml(text)}</p>`;
}

function volunteerIdFromQuery() {
  const raw = new URLSearchParams(window.location.search).get('userId');
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadStatement(userId) {
  setMessage();
  const startDate = startInput?.value;
  const endDate = endInput?.value;
  if (!startDate || !endDate) {
    setMessage('error', 'Choose a start and end date');
    return;
  }
  if (startDate > endDate) {
    setMessage('error', 'Start date must be on or before end date');
    return;
  }

  try {
    const qs = new URLSearchParams({ startDate, endDate });
    const res = await apiRequest(`/admin/volunteers/${userId}/hours-statement?${qs}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to load hours statement');
      return;
    }
    const statement = await res.json();
    if (introText && statement.volunteer?.name) {
      introText.textContent = `Hours statement for ${statement.volunteer.name}. Print for school, Duke of Edinburgh, or employment references.`;
    }
    renderStatementSheet(sheet, statement);
    if (printButton) printButton.hidden = false;
  } catch (error) {
    console.error('[HoursStatement] staff load error:', error);
    setMessage('error', 'Unable to load hours statement');
  }
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  applyRoleVisibility(user);
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }

  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  const userId = volunteerIdFromQuery();
  if (!userId) {
    setMessage('error', 'Open this page from a volunteer profile.');
    rangeForm?.setAttribute('hidden', 'hidden');
    return;
  }

  const defaults = defaultStatementRange();
  if (startInput && !startInput.value) startInput.value = defaults.startDate;
  if (endInput && !endInput.value) endInput.value = defaults.endDate;

  rangeForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    loadStatement(userId);
  });
  printButton?.addEventListener('click', () => window.print());

  await loadStatement(userId);
}

document.addEventListener('DOMContentLoaded', init);
