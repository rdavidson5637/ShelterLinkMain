import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole} from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const exportAllVolunteersButton = document.getElementById('exportAllVolunteersButton');
const exportCommunityServiceButton = document.getElementById('exportCommunityServiceButton');
const hoursExportForm = document.getElementById('hoursExportForm');
const reportUserId = document.getElementById('reportUserId');
const reportStartDate = document.getElementById('reportStartDate');
const reportEndDate = document.getElementById('reportEndDate');
const clearReportFiltersButton = document.getElementById('clearReportFiltersButton');
const leaderboardEl = document.getElementById('leaderboard');
const monthlyChartEl = document.getElementById('monthlyChart');

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function enforceAdmin() {
  const user = await checkAuth();
  if (!isAdminRole(user)) {
    window.location.href = '/login.html';
    return null;
  }
  return user;
}

function triggerDownload(url) {
  window.location.href = url;
}

function handleVolunteerExport() {
  triggerDownload(`${API_URL}/export/volunteers`);
}

function handleCommunityServiceExport() {
  triggerDownload(`${API_URL}/export/community-service`);
}

function handleHoursExport(event) {
  event.preventDefault();
  const params = new URLSearchParams();
  const userId = reportUserId?.value?.trim();
  const startDate = reportStartDate?.value;
  const endDate = reportEndDate?.value;

  if (userId) params.set('userId', userId);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const query = params.toString();
  const url = `${API_URL}/export/hours${query ? `?${query}` : ''}`;
  triggerDownload(url);
}

function clearFilters() {
  if (reportUserId) reportUserId.value = '';
  if (reportStartDate) reportStartDate.value = '';
  if (reportEndDate) reportEndDate.value = '';
}

function renderLeaderboard(rows) {
  if (!leaderboardEl) return;
  if (!rows.length) {
    leaderboardEl.innerHTML = '<p>No approved hours this year yet.</p>';
    return;
  }
  leaderboardEl.innerHTML = `
    <ol>
      ${rows.map((r) => `<li><strong>${r.name}</strong> — ${Number(r.total_hours).toFixed(1)} hrs</li>`).join('')}
    </ol>
  `;
}

function renderMonthlyChart(months) {
  if (!monthlyChartEl) return;
  const max = Math.max(...months.map((m) => Number(m.total_hours) || 0), 1);
  const width = 480;
  const height = 180;
  const barWidth = 28;
  const gap = 10;
  const bars = months.map((m, i) => {
    const value = Number(m.total_hours) || 0;
    const barHeight = Math.round((value / max) * 120);
    const x = 20 + i * (barWidth + gap);
    const y = height - 30 - barHeight;
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#2e7d32"></rect>
      <text x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle" font-size="10">${MONTH_LABELS[i]}</text>
    `;
  }).join('');

  monthlyChartEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Monthly approved hours">
      ${bars}
    </svg>
  `;
}

async function loadImpactReports() {
  try {
    const [boardRes, chartRes] = await Promise.all([
      apiRequest('/admin/stats/leaderboard', { method: 'GET' }),
      apiRequest('/admin/stats/monthly-hours', { method: 'GET' }),
    ]);
    if (boardRes.ok) renderLeaderboard(await boardRes.json());
    if (chartRes.ok) {
      const data = await chartRes.json();
      renderMonthlyChart(data.months || []);
    }
  } catch (error) {
    console.error('[Admin] impact reports error:', error);
  }
}

async function init() {
  await requireAuth();
  await enforceAdmin();

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  if (exportAllVolunteersButton) {
    exportAllVolunteersButton.addEventListener('click', (event) => {
      event.preventDefault();
      handleVolunteerExport();
    });
  }

  if (exportCommunityServiceButton) {
    exportCommunityServiceButton.addEventListener('click', (event) => {
      event.preventDefault();
      handleCommunityServiceExport();
    });
  }

  if (hoursExportForm) {
    hoursExportForm.addEventListener('submit', handleHoursExport);
  }

  if (clearReportFiltersButton) {
    clearReportFiltersButton.addEventListener('click', clearFilters);
  }

  await loadImpactReports();
}

document.addEventListener('DOMContentLoaded', init);
