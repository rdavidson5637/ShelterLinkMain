import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { createDateBlock, createEmptyState, createRuledRow } from '../components/rows.js';
import { mountInstallPrompt } from '../components/installPrompt.js';

const logoutButton = document.getElementById('logoutButton');
const statsGrid = document.getElementById('statsGrid');
const statsError = document.getElementById('statsError');
const totalVolunteersEl = document.getElementById('totalVolunteers');
const approvedVolunteersEl = document.getElementById('approvedVolunteers');
const pendingApplicationsEl = document.getElementById('pendingApplications');
const activeOpportunitiesEl = document.getElementById('activeOpportunities');
const hoursThisMonthEl = document.getElementById('hoursThisMonth');
const totalHoursAllTimeEl = document.getElementById('totalHoursAllTime');
const recentApplicationsTable = document.getElementById('recentApplicationsTable');
const recentHoursTable = document.getElementById('recentHoursTable');
const needsYouList = document.getElementById('needsYouList');
const quickActionsContainer = document.getElementById('quickActions');
const exportVolunteersButton = document.getElementById('exportVolunteersButton');
const exportHoursButton = document.getElementById('exportHoursButton');
const hoursExportStartDate = document.getElementById('hoursExportStartDate');
const hoursExportEndDate = document.getElementById('hoursExportEndDate');

function formatNumber(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString();
}

function personName(row) {
  return `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Volunteer';
}

function setFigure(el, value) {
  if (el) el.textContent = formatNumber(value);
}

function showStatsError(failed) {
  if (statsGrid) statsGrid.hidden = failed;
  if (statsError) statsError.hidden = !failed;
}

async function loadStats() {
  try {
    const res = await apiRequest('/admin/stats', { method: 'GET' });
    if (!res.ok) {
      showStatsError(true);
      return null;
    }

    const stats = await res.json();
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      showStatsError(true);
      return null;
    }
    showStatsError(false);
    setFigure(totalVolunteersEl, stats.totalVolunteers);
    setFigure(approvedVolunteersEl, stats.totalApprovedVolunteers);
    setFigure(pendingApplicationsEl, stats.pendingApplications);
    setFigure(activeOpportunitiesEl, stats.activeOpportunities);
    setFigure(hoursThisMonthEl, stats.totalHoursThisMonth);
    setFigure(totalHoursAllTimeEl, stats.totalHoursAllTime);
    return stats;
  } catch (error) {
    console.error('[Dashboard] loadStats error:', error);
    showStatsError(true);
    return null;
  }
}

function fillList(host, rows, emptySentence, action) {
  if (!host) return;
  host.replaceChildren();
  if (!rows.length) {
    const item = document.createElement('li');
    item.className = 'ruled-row';
    item.appendChild(createEmptyState(emptySentence, action));
    host.appendChild(item);
    return;
  }
  rows.forEach((row) => host.appendChild(row));
}

async function loadRecentApplications() {
  if (!recentApplicationsTable) return 0;

  try {
    const res = await apiRequest('/applications', { method: 'GET' });
    if (!res.ok) {
      fillList(recentApplicationsTable, [], 'Could not load applications.');
      return 0;
    }

    const applications = await res.json();
    const recent = Array.isArray(applications) ? applications.slice(0, 5) : [];
    fillList(
      recentApplicationsTable,
      recent.map((app) => createRuledRow({
        lead: createDateBlock(app.created_at),
        title: personName(app),
        titleHref: '/pages/admin/review-applications.html',
        details: [app.opportunity_title || 'Opportunity', formatDateOnly(app.created_at) || ''],
        end: [createStatusBadge(app.status)],
      })),
      'No applications yet.',
      { href: '/pages/admin/opportunities.html', label: 'Open shifts' }
    );
    return recent.length;
  } catch (error) {
    console.error('[Dashboard] loadRecentApplications error:', error);
    fillList(recentApplicationsTable, [], 'Could not load applications.');
    return 0;
  }
}

async function loadRecentHours() {
  if (!recentHoursTable) return 0;

  try {
    const res = await apiRequest('/hours/pending?limit=5', { method: 'GET' });
    if (!res.ok) {
      fillList(recentHoursTable, [], 'Could not load hours.');
      return 0;
    }

    const hours = await res.json();
    const list = Array.isArray(hours) ? hours : [];
    const recent = list.slice(-5).reverse();
    fillList(
      recentHoursTable,
      recent.map((entry) => createRuledRow({
        lead: createDateBlock(entry.date || entry.created_at),
        title: personName(entry),
        titleHref: '/pages/admin/approve-hours.html',
        details: [
          entry.opportunity_title || 'Opportunity',
          `${entry.hours || 0} hours on ${formatDateOnly(entry.date || entry.created_at) || 'an unknown date'}`,
        ],
      })),
      'No hour logs are waiting.',
      { href: '/pages/admin/approve-hours.html', label: 'Approve hours' }
    );
    return list.length;
  } catch (error) {
    console.error('[Dashboard] loadRecentHours error:', error);
    fillList(recentHoursTable, [], 'Could not load hours.');
    return 0;
  }
}

function checkTypeLabel(value) {
  const labels = {
    accessni_basic: 'AccessNI Basic',
    accessni_standard: 'AccessNI Standard',
    accessni_enhanced: 'AccessNI Enhanced',
    other: 'Other check',
  };
  return labels[value] || 'Background check';
}

async function loadExpiringChecks() {
  const host = document.getElementById('expiringChecks');
  if (!host) return 0;
  try {
    const res = await apiRequest('/vetting/admin/expiring', { method: 'GET' });
    if (!res.ok) {
      host.replaceChildren();
      host.appendChild(createEmptyState('Could not load expiring checks.'));
      return 0;
    }
    const rows = await res.json();
    host.replaceChildren();
    if (!Array.isArray(rows) || !rows.length) {
      host.appendChild(createEmptyState('No clear checks expire in the next 60 days.'));
      return 0;
    }
    const list = document.createElement('ul');
    list.className = 'ruled-rows';
    rows.forEach((row) => {
      list.appendChild(createRuledRow({
        lead: createDateBlock(row.expires_on),
        title: personName(row),
        titleHref: `/pages/admin/volunteers.html?user=${encodeURIComponent(row.user_id)}`,
        details: [
          `${checkTypeLabel(row.check_type)}, ${row.status || 'clear'}`,
          `Expires ${formatDateOnly(row.expires_on) || 'on an unknown date'}`,
        ],
        needsYou: true,
      }));
    });
    host.appendChild(list);
    return rows.length;
  } catch (error) {
    console.error('[Dashboard] loadExpiringChecks error:', error);
    return 0;
  }
}

function renderNeedsYou({ pending, hoursWaiting, checks }) {
  if (!needsYouList) return;
  const items = [];
  if (pending > 0) {
    const noun = pending === 1 ? 'application is' : 'applications are';
    items.push(createRuledRow({
      title: `${pending} ${noun} waiting`,
      titleHref: '/pages/admin/review-applications.html',
      details: ['Review who has applied.'],
      needsYou: true,
    }));
  }
  if (hoursWaiting > 0) {
    const noun = hoursWaiting === 1 ? 'hour log needs' : 'hour logs need';
    items.push(createRuledRow({
      title: `${hoursWaiting} ${noun} approval`,
      titleHref: '/pages/admin/approve-hours.html',
      details: ['Check the hours before they are counted.'],
      needsYou: true,
    }));
  }
  if (checks > 0) {
    const noun = checks === 1 ? 'check expires' : 'checks expire';
    items.push(createRuledRow({
      title: `${checks} ${noun} in the next 60 days`,
      titleHref: '#expiringChecksHeading',
      details: ['Look at the list on this page.'],
      needsYou: true,
    }));
  }
  needsYouList.replaceChildren();
  if (!items.length) {
    const item = document.createElement('li');
    item.className = 'ruled-row';
    item.appendChild(createEmptyState('Nothing needs you right now.'));
    needsYouList.appendChild(item);
    return;
  }
  items.forEach((item) => needsYouList.appendChild(item));
}

async function enforceAdmin() {
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return null;
  }
  applyRoleVisibility(user);
  return user;
}

function attachQuickActionHandlers() {
  if (!quickActionsContainer) return;
  quickActionsContainer.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (link.href) {
        window.location.href = link.href;
      }
    });
  });
}

function attachExportHandlers() {
  if (exportVolunteersButton) {
    exportVolunteersButton.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = `${API_URL}/export/volunteers`;
    });
  }

  if (exportHoursButton) {
    exportHoursButton.addEventListener('click', (event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      const start = hoursExportStartDate?.value;
      const end = hoursExportEndDate?.value;
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      const query = params.toString();
      const url = `${API_URL}/export/hours${query ? `?${query}` : ''}`;
      window.location.href = url;
    });
  }
}

async function init() {
  mountInstallPrompt(document.getElementById('installPrompt'));
  await requireAuth();
  await enforceAdmin();

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  attachQuickActionHandlers();
  attachExportHandlers();

  const [stats, , hoursWaiting, checks] = await Promise.all([
    loadStats(),
    loadRecentApplications(),
    loadRecentHours(),
    loadExpiringChecks(),
  ]);

  renderNeedsYou({
    pending: Number(stats?.pendingApplications) || 0,
    hoursWaiting,
    checks,
  });

  setInterval(async () => {
    const next = await loadStats();
    if (!next) return;
    renderNeedsYou({
      pending: Number(next.pendingApplications) || 0,
      hoursWaiting,
      checks,
    });
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
