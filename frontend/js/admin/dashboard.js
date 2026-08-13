import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const statsGrid = document.getElementById('statsGrid');
const totalVolunteersEl = document.getElementById('totalVolunteers');
const approvedVolunteersEl = document.getElementById('approvedVolunteers');
const pendingApplicationsEl = document.getElementById('pendingApplications');
const pendingBadgeEl = document.getElementById('pendingBadge');
const activeOpportunitiesEl = document.getElementById('activeOpportunities');
const hoursThisMonthEl = document.getElementById('hoursThisMonth');
const totalHoursAllTimeEl = document.getElementById('totalHoursAllTime');
const recentApplicationsTable = document.getElementById('recentApplicationsTable');
const recentHoursTable = document.getElementById('recentHoursTable');
const quickActionsContainer = document.getElementById('quickActions');
const exportVolunteersButton = document.getElementById('exportVolunteersButton');
const exportHoursButton = document.getElementById('exportHoursButton');
const hoursExportStartDate = document.getElementById('hoursExportStartDate');
const hoursExportEndDate = document.getElementById('hoursExportEndDate');

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return Number(num).toLocaleString();
}

async function loadStats() {
  try {
    const res = await apiRequest('/admin/stats', { method: 'GET' });
    if (!res.ok) {
      console.error('[Dashboard] Failed to load stats');
      return;
    }

    const stats = await res.json();

    // Update stat cards
    if (totalVolunteersEl) {
      totalVolunteersEl.textContent = formatNumber(stats.totalVolunteers);
    }
    if (approvedVolunteersEl) {
      approvedVolunteersEl.textContent = formatNumber(stats.totalApprovedVolunteers);
    }
    if (pendingApplicationsEl) {
      pendingApplicationsEl.textContent = formatNumber(stats.pendingApplications);
    }
    if (pendingBadgeEl) {
      if (stats.pendingApplications > 0) {
        pendingBadgeEl.textContent = stats.pendingApplications;
        pendingBadgeEl.style.display = 'inline-block';
      } else {
        pendingBadgeEl.style.display = 'none';
      }
    }
    if (activeOpportunitiesEl) {
      activeOpportunitiesEl.textContent = formatNumber(stats.activeOpportunities);
    }
    if (hoursThisMonthEl) {
      hoursThisMonthEl.textContent = formatNumber(stats.totalHoursThisMonth);
    }
    if (totalHoursAllTimeEl) {
      totalHoursAllTimeEl.textContent = formatNumber(stats.totalHoursAllTime);
    }
  } catch (error) {
    console.error('[Dashboard] loadStats error:', error);
  }
}

async function loadRecentApplications() {
  if (!recentApplicationsTable) return;

  try {
    const res = await apiRequest('/applications?limit=5', { method: 'GET' });
    if (!res.ok) {
      recentApplicationsTable.innerHTML = '<tr><td colspan="4">Failed to load applications</td></tr>';
      return;
    }

    const applications = await res.json();
    const recent = applications.slice(0, 5);

    if (!recent.length) {
      recentApplicationsTable.innerHTML = '<tr><td colspan="4">No applications yet</td></tr>';
      return;
    }

    recentApplicationsTable.innerHTML = '';

    recent.forEach((app) => {
      const tr = document.createElement('tr');
      
      const volunteerTd = document.createElement('td');
      const fullName = `${app.first_name || ''} ${app.last_name || ''}`.trim() || app.email || 'N/A';
      volunteerTd.textContent = fullName;

      const opportunityTd = document.createElement('td');
      opportunityTd.textContent = app.opportunity_title || 'N/A';

      const dateTd = document.createElement('td');
      dateTd.textContent = formatDate(app.created_at);

      const statusTd = document.createElement('td');
      statusTd.textContent = app.status || 'N/A';
      if (app.status === 'accepted') {
        statusTd.style.color = '#4caf50';
      } else if (app.status === 'pending') {
        statusTd.style.color = '#ff9800';
      } else if (app.status === 'rejected') {
        statusTd.style.color = '#f44336';
      }

      tr.appendChild(volunteerTd);
      tr.appendChild(opportunityTd);
      tr.appendChild(dateTd);
      tr.appendChild(statusTd);

      recentApplicationsTable.appendChild(tr);
    });
  } catch (error) {
    console.error('[Dashboard] loadRecentApplications error:', error);
    recentApplicationsTable.innerHTML = '<tr><td colspan="4">Error loading applications</td></tr>';
  }
}

async function loadRecentHours() {
  if (!recentHoursTable) return;

  try {
    const res = await apiRequest('/hours/pending?limit=5', { method: 'GET' });
    if (!res.ok) {
      recentHoursTable.innerHTML = '<tr><td colspan="4">Failed to load hours</td></tr>';
      return;
    }

    const hours = await res.json();
    // Reverse to get most recent first (since they're sorted ASC by created_at)
    const recent = hours.slice(-5).reverse();

    if (!recent.length) {
      recentHoursTable.innerHTML = '<tr><td colspan="4">No recent hour submissions</td></tr>';
      return;
    }

    recentHoursTable.innerHTML = '';

    recent.forEach((entry) => {
      const tr = document.createElement('tr');
      
      const volunteerTd = document.createElement('td');
      const fullName = `${entry.first_name || ''} ${entry.last_name || ''}`.trim() || entry.email || 'N/A';
      volunteerTd.textContent = fullName;

      const opportunityTd = document.createElement('td');
      opportunityTd.textContent = entry.opportunity_title || 'N/A';

      const dateTd = document.createElement('td');
      dateTd.textContent = formatDate(entry.date || entry.created_at);

      const hoursTd = document.createElement('td');
      hoursTd.textContent = entry.hours || 0;

      tr.appendChild(volunteerTd);
      tr.appendChild(opportunityTd);
      tr.appendChild(dateTd);
      tr.appendChild(hoursTd);

      recentHoursTable.appendChild(tr);
    });
  } catch (error) {
    console.error('[Dashboard] loadRecentHours error:', error);
    recentHoursTable.innerHTML = '<tr><td colspan="4">Error loading hours</td></tr>';
  }
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
  const links = quickActionsContainer.querySelectorAll('a[role="button"]');
  links.forEach((link) => {
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
  await requireAuth();
  await enforceAdmin();

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  // Attach handlers
  attachQuickActionHandlers();
  attachExportHandlers();

  // Load all data initially
  await Promise.all([
    loadStats(),
    loadRecentApplications(),
    loadRecentHours(),
  ]);

  // Optionally auto-refresh stats every 60 seconds
  setInterval(loadStats, 60000);
}

document.addEventListener('DOMContentLoaded', init);

