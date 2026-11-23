import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const messageEl = document.getElementById('message');
const hoursThisYearEl = document.getElementById('hoursThisYear');
const totalHoursEl = document.getElementById('totalHours');
const shiftsCompletedEl = document.getElementById('shiftsCompleted');
const sheltersHelpedEl = document.getElementById('sheltersHelped');
const trainingCompletedEl = document.getElementById('trainingCompleted');
const yearNoteEl = document.getElementById('impactYearNote');
const logoutButton = document.getElementById('logoutButton');

function formatHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function setMessage(text, tone = 'error') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const css = tone === 'error' ? 'error' : 'success';
  messageEl.innerHTML = `<p class="${css}">${escapeHtml(text)}</p>`;
}

function renderImpact(stats) {
  if (hoursThisYearEl) hoursThisYearEl.textContent = formatHours(stats.hoursThisYear);
  if (totalHoursEl) totalHoursEl.textContent = formatHours(stats.totalHours);
  if (shiftsCompletedEl) {
    shiftsCompletedEl.textContent = String(Number(stats.shiftsCompleted) || 0);
  }
  if (sheltersHelpedEl) {
    sheltersHelpedEl.textContent = String(Number(stats.sheltersHelped) || 0);
  }
  if (trainingCompletedEl) {
    trainingCompletedEl.textContent = String(Number(stats.trainingCompleted) || 0);
  }
  if (yearNoteEl) {
    const year = Number(stats.year) || new Date().getFullYear();
    yearNoteEl.textContent = `Hours this year counts approved hours dated in ${year}.`;
  }
}

async function loadImpact() {
  setMessage('');
  try {
    const res = await apiRequest('/stats/me', { method: 'GET' });
    if (!res.ok) {
      setMessage('Unable to load your impact figures.');
      return;
    }
    const stats = await res.json();
    renderImpact(stats);
  } catch (error) {
    console.error('[MyImpact] load error:', error);
    setMessage('Unable to load your impact figures.');
  }
}

async function init() {
  const ok = await requireAuth({ roles: ['volunteer', 'staff', 'admin'] });
  if (!ok) return;
  if (logoutButton) {
    logoutButton.addEventListener('click', () => logout());
  }
  await loadImpact();
}

init();
