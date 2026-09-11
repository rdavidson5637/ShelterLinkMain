import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const issueButton = document.getElementById('issueButton');
const printButton = document.getElementById('printButton');
const logoutButton = document.getElementById('logoutButton');
const sheet = document.getElementById('certificateSheet');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const css = type === 'error' ? 'error' : 'success';
  messageEl.innerHTML = `<p class="${css}">${text}</p>`;
}

function renderCertificate(cert) {
  if (!sheet || !cert) return;
  const name = `${cert.first_name || ''} ${cert.last_name || ''}`.trim() || 'Volunteer';
  document.getElementById('certName').textContent = name;
  document.getElementById('certHours').textContent = Number(cert.hours_at_issue || 0).toFixed(1);
  document.getElementById('certShifts').textContent = String(cert.shifts_at_issue || 0);
  document.getElementById('certIssued').textContent =
    formatDateOnly(cert.issued_at) || String(cert.issued_at || '').slice(0, 10);
  document.getElementById('certCode').textContent = cert.code || '—';
  const verifyUrl = `${window.location.origin}/api/public/verify-certificate/${encodeURIComponent(
    cert.code || ''
  )}`;
  document.getElementById('certVerifyUrl').textContent = verifyUrl;

  const badgesEl = document.getElementById('certBadges');
  const badges = cert.badges || [];
  if (badges.length) {
    badgesEl.innerHTML = `<p><strong>Badges earned:</strong> ${badges
      .map((b) => `${b.emoji || ''} ${b.label}`.trim())
      .join(', ')}</p>`;
  } else {
    badgesEl.innerHTML = '';
  }

  sheet.hidden = false;
  if (printButton) printButton.hidden = false;
}

async function loadLatest() {
  try {
    const res = await apiRequest('/volunteer/certificate');
    if (res.status === 404) {
      sheet.hidden = true;
      if (printButton) printButton.hidden = true;
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to load certificate');
      return;
    }
    renderCertificate(await res.json());
  } catch (error) {
    console.error('[Certificate] load error:', error);
    setMessage('error', 'Unable to load certificate');
  }
}

async function issueCertificate() {
  setMessage();
  try {
    const res = await apiRequest('/volunteer/certificate', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to issue certificate');
      return;
    }
    renderCertificate(await res.json());
    setMessage('success', 'Certificate issued. Use Print to save a PDF.');
  } catch (error) {
    console.error('[Certificate] issue error:', error);
    setMessage('error', 'Unable to issue certificate');
  }
}

async function init() {
  await requireAuth();
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
  issueButton?.addEventListener('click', issueCertificate);
  printButton?.addEventListener('click', () => window.print());
  await loadLatest();
}

document.addEventListener('DOMContentLoaded', init);
