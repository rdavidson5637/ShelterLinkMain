import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
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
const issueButton = document.getElementById('issueButton');
const verifySection = document.getElementById('verifySection');
const verifyDetails = document.getElementById('verifyDetails');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const css = type === 'error' ? 'error' : 'success';
  messageEl.innerHTML = `<p class="${css}">${escapeHtml(text)}</p>`;
}

async function loadStatement() {
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
    const res = await apiRequest(`/volunteer/hours-statement?${qs}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to load hours statement');
      return;
    }
    const statement = await res.json();
    renderStatementSheet(sheet, statement);
    if (printButton) printButton.hidden = false;
    if (verifySection) verifySection.hidden = false;
  } catch (error) {
    console.error('[HoursStatement] load error:', error);
    setMessage('error', 'Unable to load hours statement');
  }
}

async function issueCertificate() {
  setMessage();
  try {
    const res = await apiRequest('/volunteer/certificate', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to issue verification code');
      return;
    }
    const cert = await res.json();
    document.getElementById('certCode').textContent = cert.code || '—';
    document.getElementById('certIssued').textContent =
      formatDateOnly(cert.issued_at) || String(cert.issued_at || '').slice(0, 10);
    const verifyUrl = `${window.location.origin}/api/public/verify-certificate/${encodeURIComponent(
      cert.code || ''
    )}`;
    document.getElementById('certVerifyUrl').textContent = verifyUrl;
    if (verifyDetails) verifyDetails.hidden = false;
    setMessage('success', 'Verification code issued.');
  } catch (error) {
    console.error('[Certificate] issue error:', error);
    setMessage('error', 'Unable to issue verification code');
  }
}

async function init() {
  await requireAuth();
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  const defaults = defaultStatementRange();
  if (startInput && !startInput.value) startInput.value = defaults.startDate;
  if (endInput && !endInput.value) endInput.value = defaults.endDate;

  rangeForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    loadStatement();
  });
  printButton?.addEventListener('click', () => window.print());
  issueButton?.addEventListener('click', issueCertificate);

  await loadStatement();
}

document.addEventListener('DOMContentLoaded', init);
