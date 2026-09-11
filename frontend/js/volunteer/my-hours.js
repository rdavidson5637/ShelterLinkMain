import { API_URL, apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';

const totalApprovedHoursEl = document.getElementById('totalApprovedHours');
const totalPendingHoursEl = document.getElementById('totalPendingHours');
const exportCsvButton = document.getElementById('exportCsvButton');
const filtersForm = document.getElementById('filtersForm');
const filterStartDate = document.getElementById('filterStartDate');
const filterEndDate = document.getElementById('filterEndDate');
const filterOpportunity = document.getElementById('filterOpportunity');
const filterStatus = document.getElementById('filterStatus');
const clearFiltersButton = document.getElementById('clearFiltersButton');
const hoursTableBody = document.getElementById('hoursTableBody');
const feedbackShiftsBody = document.getElementById('feedbackShiftsBody');
const logoutButton = document.getElementById('logoutButton');

let allHours = [];

function formatDate(dateString) {
  return formatDateOnly(dateString) || 'N/A';
}

function calculateSummary(hours) {
  let approvedTotal = 0;
  let pendingTotal = 0;

  hours.forEach((entry) => {
    const hoursValue = parseFloat(entry.hours) || 0;
    if (entry.approved) {
      approvedTotal += hoursValue;
    } else {
      pendingTotal += hoursValue;
    }
  });

  return { approvedTotal, pendingTotal };
}

function updateSummary(hours) {
  const { approvedTotal, pendingTotal } = calculateSummary(hours);
  if (totalApprovedHoursEl) totalApprovedHoursEl.textContent = approvedTotal.toFixed(1);
  if (totalPendingHoursEl) totalPendingHoursEl.textContent = pendingTotal.toFixed(1);
}

function populateOpportunityFilter(hours) {
  if (!filterOpportunity) return;

  const uniqueOpportunities = Array.from(
    new Set(
      hours
        .map((h) => ({
          id: h.opportunity_id,
          title: h.opportunity_title || `Opportunity #${h.opportunity_id}`,
        }))
        .filter((o) => o.id)
    )
  ).sort((a, b) => a.title.localeCompare(b.title));

  const currentValue = filterOpportunity.value;
  filterOpportunity.innerHTML = '<option value="">All Opportunities</option>';

  uniqueOpportunities.forEach((opp) => {
    const option = document.createElement('option');
    option.value = opp.id;
    option.textContent = opp.title;
    filterOpportunity.appendChild(option);
  });

  if (currentValue) {
    filterOpportunity.value = currentValue;
  }
}

function filterHours(hours) {
  let filtered = [...hours];

  const startDate = filterStartDate?.value;
  const endDate = filterEndDate?.value;
  const opportunityId = filterOpportunity?.value;
  const status = filterStatus?.value;

  if (startDate) {
    filtered = filtered.filter((h) => {
      const entryDate = h.date || h.created_at;
      return entryDate >= startDate;
    });
  }

  if (endDate) {
    filtered = filtered.filter((h) => {
      const entryDate = h.date || h.created_at;
      return entryDate <= endDate;
    });
  }

  if (opportunityId) {
    filtered = filtered.filter((h) => Number(h.opportunity_id) === Number(opportunityId));
  }

  if (status === 'approved') {
    filtered = filtered.filter((h) => h.approved === true);
  } else if (status === 'pending') {
    filtered = filtered.filter((h) => h.approved === false);
  }

  return filtered;
}

function renderHoursTable(hours) {
  if (!hoursTableBody) return;

  const filtered = filterHours(hours);

  if (!filtered.length) {
    hoursTableBody.innerHTML = '<tr><td colspan="4">No hours found matching your filters</td></tr>';
    return;
  }

  hoursTableBody.innerHTML = '';

  filtered.forEach((entry) => {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDate(entry.date || entry.created_at);

    const opportunityTd = document.createElement('td');
    opportunityTd.textContent = entry.opportunity_title || 'N/A';

    const hoursTd = document.createElement('td');
    hoursTd.textContent = entry.hours || 0;

    const statusTd = document.createElement('td');
    statusTd.appendChild(createStatusBadge(entry.approved ? 'approved' : 'pending'));
    if (entry.verified_by_checkin) {
      statusTd.append(' ');
      statusTd.appendChild(createStatusBadge('confirmed', { suffix: ' (verified)' }));
    }

    tr.appendChild(dateTd);
    tr.appendChild(opportunityTd);
    tr.appendChild(hoursTd);
    tr.appendChild(statusTd);

    hoursTableBody.appendChild(tr);
  });
}

function setExportButtonLoading(loading) {
  if (!exportCsvButton) return;
  exportCsvButton.disabled = loading;
  exportCsvButton.setAttribute('aria-busy', loading ? 'true' : 'false');
  exportCsvButton.textContent = loading ? 'Exporting...' : 'Export CSV';
}

function getFilenameFromDisposition(contentDisposition) {
  const match = /filename="?([^"]+)"?/i.exec(contentDisposition || '');
  return match?.[1] || `my-hours-${new Date().toISOString().slice(0, 10)}.csv`;
}

async function exportMyHoursCSV() {
  setExportButtonLoading(true);
  try {
    const params = new URLSearchParams();
    if (filterStartDate?.value) params.set('startDate', filterStartDate.value);
    if (filterEndDate?.value) params.set('endDate', filterEndDate.value);

    const url = `${API_URL}/export/my-hours${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url, { method: 'GET', credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Export failed (${response.status})`);
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const filename = getFilenameFromDisposition(response.headers.get('Content-Disposition'));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('[MyHours] exportMyHoursCSV error:', error);
    alert('Unable to export CSV right now. Please try again.');
  } finally {
    setExportButtonLoading(false);
  }
}

async function loadHours() {
  if (!hoursTableBody) return;

  try {
    const res = await apiRequest('/hours/my-hours', { method: 'GET' });
    if (!res.ok) {
      hoursTableBody.innerHTML = '<tr><td colspan="4">Failed to load hours</td></tr>';
      return;
    }

    allHours = await res.json();
    
    // Calculate and display totals from all hours
    updateSummary(allHours);
    
    // Populate opportunity filter dropdown with unique opportunities
    populateOpportunityFilter(allHours);
    
    // Populate table with all entries
    renderHoursTable(allHours);
  } catch (error) {
    console.error('[MyHours] loadHours error:', error);
    hoursTableBody.innerHTML = '<tr><td colspan="4">Error loading hours</td></tr>';
  }
}

async function loadFeedbackShifts() {
  if (!feedbackShiftsBody) return;

  try {
    const res = await apiRequest('/feedback/my-past-shifts', { method: 'GET' });
    if (!res.ok) {
      feedbackShiftsBody.innerHTML = '<tr><td colspan="3">Unable to load past shifts</td></tr>';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      feedbackShiftsBody.innerHTML = '<tr><td colspan="3">No past shifts yet</td></tr>';
      return;
    }

    feedbackShiftsBody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const dateTd = document.createElement('td');
      dateTd.textContent = formatDate(row.opportunity_start_date);
      const titleTd = document.createElement('td');
      titleTd.textContent = row.opportunity_title || 'N/A';
      const actionTd = document.createElement('td');
      if (row.has_feedback) {
        actionTd.textContent =
          row.feedback_rating != null ? `Submitted (${row.feedback_rating}/5)` : 'Submitted';
      } else if (row.feedback_url) {
        const link = document.createElement('a');
        link.href = row.feedback_url;
        link.textContent = 'Leave feedback';
        actionTd.appendChild(link);
      } else {
        actionTd.textContent = 'Not submitted';
      }
      tr.appendChild(dateTd);
      tr.appendChild(titleTd);
      tr.appendChild(actionTd);
      feedbackShiftsBody.appendChild(tr);
    });
  } catch (error) {
    console.error('[MyHours] loadFeedbackShifts error:', error);
    feedbackShiftsBody.innerHTML = '<tr><td colspan="3">Error loading feedback links</td></tr>';
  }
}

function attachEventListeners() {
  if (filtersForm) {
    filtersForm.addEventListener('submit', (event) => {
      event.preventDefault();
      renderHoursTable(allHours);
    });
  }

  if (clearFiltersButton) {
    clearFiltersButton.addEventListener('click', () => {
      if (filterStartDate) filterStartDate.value = '';
      if (filterEndDate) filterEndDate.value = '';
      if (filterOpportunity) filterOpportunity.value = '';
      if (filterStatus) filterStatus.value = '';
      renderHoursTable(allHours);
    });
  }

  if (exportCsvButton) {
    exportCsvButton.addEventListener('click', () => {
      exportMyHoursCSV();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }
}

async function init() {
  await requireAuth();
  attachEventListeners();
  await Promise.all([loadHours(), loadFeedbackShifts()]);
}

document.addEventListener('DOMContentLoaded', init);

