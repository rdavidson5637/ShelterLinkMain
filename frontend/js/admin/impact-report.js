import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { toIsoDateLocal } from '../utils/dateFormat.js';
import { renderErrorState } from '../utils/listState.js';

const form = document.getElementById('impactRangeForm');
const startInput = document.getElementById('impactStartDate');
const endInput = document.getElementById('impactEndDate');
const messageEl = document.getElementById('impactMessage');
const resultsEl = document.getElementById('impactResults');
const periodEl = document.getElementById('impactPeriod');
const figuresEl = document.getElementById('impactFigures');
const activityEl = document.getElementById('impactActivity');
const monthsEl = document.getElementById('impactMonths');
const pdfLink = document.getElementById('impactPdfLink');
const csvLink = document.getElementById('impactCsvLink');
const logoutButton = document.getElementById('logoutButton');

const FIGURES = [
  ['approvedHours', 'Approved volunteer hours', 'hours'],
  ['volunteers', 'Volunteers who logged approved hours'],
  ['shifts', 'Shifts with approved hours'],
  ['walks', 'Animal walks logged'],
  ['animalsHelped', 'Animals helped'],
  ['checkinVerifiedHours', 'Hours verified by shift check-in', 'hours'],
];

function formatNumber(value, kind) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-GB', { maximumFractionDigits: kind === 'hours' ? 2 : 0 });
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function setMessage(text) {
  if (!text) {
    messageEl.replaceChildren();
    return;
  }
  const p = document.createElement('p');
  p.className = 'error-message';
  p.textContent = text;
  messageEl.replaceChildren(p);
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function row(cells) {
  const tr = document.createElement('tr');
  tr.append(...cells);
  return tr;
}

function emptyRow(text) {
  const td = document.createElement('td');
  td.colSpan = 3;
  td.textContent = text;
  return row([td]);
}

function render(report) {
  periodEl.textContent = `${formatDate(report.startDate)} to ${formatDate(report.endDate)}`;

  figuresEl.replaceChildren(
    ...FIGURES.map(([key, label, kind]) => {
      const wrap = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = formatNumber(report.summary[key], kind);
      wrap.append(dt, dd);
      return wrap;
    })
  );

  const logged = report.activity.filter((a) => a.entries > 0);
  activityEl.replaceChildren(
    ...(logged.length
      ? logged.map((a) => row([cell(a.label), cell(formatNumber(a.entries), 'num'), cell(formatNumber(a.animals), 'num')]))
      : [emptyRow('No animal activity was logged in this period.')])
  );

  monthsEl.replaceChildren(
    ...(report.months.length
      ? report.months.map((m) => row([cell(formatMonth(m.month)), cell(formatNumber(m.volunteers), 'num'), cell(formatNumber(m.hours, 'hours'), 'num')]))
      : [emptyRow('No approved hours were recorded in this period.')])
  );

  const query = new URLSearchParams({ startDate: report.startDate, endDate: report.endDate }).toString();
  pdfLink.href = `${API_URL}/admin/reports/impact.pdf?${query}`;
  csvLink.href = `${API_URL}/admin/reports/impact.csv?${query}`;
  resultsEl.hidden = false;
}

async function loadReport() {
  const startDate = startInput.value;
  const endDate = endInput.value;
  setMessage('');
  if (!startDate || !endDate) {
    setMessage('Choose a start date and an end date.');
    return;
  }
  if (startDate > endDate) {
    setMessage('The start date must be on or before the end date.');
    return;
  }

  const query = new URLSearchParams({ startDate, endDate }).toString();
  try {
    const res = await apiRequest(`/admin/reports/impact?${query}`, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      resultsEl.hidden = true;
      setMessage(data.error || 'The report could not be loaded.');
      return;
    }
    render(data);
  } catch (error) {
    resultsEl.hidden = true;
    messageEl.replaceChildren(
      renderErrorState({
        title: 'The report could not be loaded',
        body: error.message || 'Check your connection and try again.',
        onRetry: loadReport,
      })
    );
  }
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }

  logoutButton?.addEventListener('click', (event) => {
    event.preventDefault();
    logout();
  });

  // Default to the calendar year so far; staff can change either date.
  const today = new Date();
  startInput.value = `${today.getFullYear()}-01-01`;
  endInput.value = toIsoDateLocal(today);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadReport();
  });

  await loadReport();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error(err));
});
