import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, isAdminRole, applyRoleVisibility} from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { mountInstallPrompt } from '../components/installPrompt.js';

const logoutButton = document.getElementById('logoutButton');
const totalVolunteersEl = document.getElementById('totalVolunteers');
const approvedVolunteersEl = document.getElementById('approvedVolunteers');
const pendingApplicationsEl = document.getElementById('pendingApplications');
const activeOpportunitiesEl = document.getElementById('activeOpportunities');
const hoursThisMonthEl = document.getElementById('hoursThisMonth');
const totalHoursAllTimeEl = document.getElementById('totalHoursAllTime');
const recentApplicationsTable = document.getElementById('recentApplicationsTable');
const recentHoursTable = document.getElementById('recentHoursTable');
const exportVolunteersButton = document.getElementById('exportVolunteersButton');
const exportHoursButton = document.getElementById('exportHoursButton');
const hoursExportStartDate = document.getElementById('hoursExportStartDate');
const hoursExportEndDate = document.getElementById('hoursExportEndDate');

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
      dateTd.textContent = formatDateOnly(app.created_at) || 'N/A';

      const statusTd = document.createElement('td');
      statusTd.appendChild(createStatusBadge(app.status));

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
      dateTd.textContent = formatDateOnly(entry.date || entry.created_at) || 'N/A';

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
  if (!host) return;
  try {
    const res = await apiRequest('/vetting/admin/expiring', { method: 'GET' });
    if (!res.ok) {
      host.replaceChildren();
      const message = document.createElement('p');
      message.textContent = 'Could not load expiring checks.';
      host.appendChild(message);
      return;
    }
    const rows = await res.json();
    host.replaceChildren();
    if (!Array.isArray(rows) || !rows.length) {
      const message = document.createElement('p');
      message.textContent = 'No clear checks expire in the next 60 days.';
      host.appendChild(message);
      return;
    }
    const list = document.createElement('ul');
    rows.forEach((row) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Volunteer';
      link.href = `/pages/admin/volunteers.html?user=${encodeURIComponent(row.user_id)}`;
      link.textContent = name;
      item.appendChild(link);
      const detail = document.createElement('span');
      detail.textContent = ` · ${checkTypeLabel(row.check_type)} · ${row.status || 'clear'} · expires ${formatDateOnly(row.expires_on) || 'unknown'}`;
      item.appendChild(detail);
      list.appendChild(item);
    });
    host.appendChild(list);
  } catch (error) {
    console.error('[Dashboard] loadExpiringChecks error:', error);
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

function renderSetupChecklist(checklist) {
  const section = document.getElementById('setupChecklistSection');
  const summary = document.getElementById('setupChecklistSummary');
  const list = document.getElementById('setupChecklistList');
  const dismissBtn = document.getElementById('setupChecklistDismiss');
  if (!section || !summary || !list) return;

  if (!checklist || !checklist.visible) {
    section.hidden = true;
    list.replaceChildren();
    return;
  }

  section.hidden = false;
  summary.textContent = checklist.complete
    ? 'Every setup step is done. You can dismiss this list.'
    : `${checklist.doneCount} of ${checklist.total} setup steps done.`;

  if (dismissBtn) {
    dismissBtn.hidden = !checklist.complete;
    dismissBtn.disabled = false;
  }

  list.replaceChildren();
  (checklist.items || []).forEach((item) => {
    const li = document.createElement('li');
    if (item.done) {
      const row = document.createElement('div');
      row.className = 'setup-checklist-done';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('span');
      detail.textContent = ' Done';
      row.appendChild(title);
      row.appendChild(detail);
      li.appendChild(row);
    } else {
      const link = document.createElement('a');
      link.href = item.href;
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('span');
      detail.className = 'setup-checklist-detail';
      detail.textContent = item.detail;
      copy.appendChild(title);
      copy.appendChild(detail);
      const arrow = document.createElement('span');
      arrow.className = 'choice-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      link.appendChild(copy);
      link.appendChild(arrow);
      li.appendChild(link);
    }
    list.appendChild(li);
  });
}

async function loadSetupChecklist() {
  const section = document.getElementById('setupChecklistSection');
  try {
    const res = await apiRequest('/admin/setup-checklist', { method: 'GET' });
    if (res.status === 403) {
      if (section) section.hidden = true;
      return;
    }
    if (!res.ok) {
      if (section) {
        section.hidden = false;
        const summary = document.getElementById('setupChecklistSummary');
        if (summary) summary.textContent = 'Could not load setup progress.';
      }
      return;
    }
    renderSetupChecklist(await res.json());
  } catch (error) {
    console.error('[Dashboard] loadSetupChecklist error:', error);
  }
}

async function dismissSetupChecklist() {
  const dismissBtn = document.getElementById('setupChecklistDismiss');
  if (dismissBtn) dismissBtn.disabled = true;
  try {
    const res = await apiRequest('/admin/setup-checklist/dismiss', { method: 'POST', body: {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const summary = document.getElementById('setupChecklistSummary');
      if (summary) summary.textContent = body.error || 'Could not dismiss the checklist.';
      if (dismissBtn) dismissBtn.disabled = false;
      return;
    }
    renderSetupChecklist(body);
  } catch (error) {
    console.error('[Dashboard] dismissSetupChecklist error:', error);
    if (dismissBtn) dismissBtn.disabled = false;
  }
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
  const user = await enforceAdmin();

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  attachExportHandlers();

  const dismissBtn = document.getElementById('setupChecklistDismiss');
  dismissBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    dismissSetupChecklist();
  });

  // Load all data initially
  const loads = [
    loadStats(),
    loadRecentApplications(),
    loadRecentHours(),
    loadExpiringChecks(),
  ];
  if (user && isAdminRole(user)) {
    loads.push(loadSetupChecklist());
  }
  await Promise.all(loads);

  // Optionally auto-refresh stats every 60 seconds
  setInterval(loadStats, 60000);
}

document.addEventListener('DOMContentLoaded', init);

