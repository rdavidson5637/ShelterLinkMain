import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';
import { formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';

const logHoursForm = document.getElementById('logHoursForm');
const opportunitySelect = document.getElementById('opportunityId');
const dateInput = document.getElementById('date');
const hoursInput = document.getElementById('hours');
const submitButton = document.getElementById('submitButton');
const messageEl = document.getElementById('message');
const hoursTableBody = document.getElementById('hoursTableBody');
const logoutButton = document.getElementById('logoutButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function setMaxDate() {
  if (!dateInput) return;
  const today = new Date();
  dateInput.max = today.toISOString().split('T')[0];
}

async function loadApprovedApplications() {
  if (!opportunitySelect) return;

  try {
    const res = await apiRequest('/applications/my-applications', { method: 'GET' });
    if (!res.ok) {
      opportunitySelect.innerHTML = '<option value="" disabled>No approved applications found</option>';
      setMessage('You need approved applications to log hours', 'error');
      return;
    }

    const applications = await res.json();
    const approved = applications.filter(
      (app) => app.status === 'accepted' || app.status === 'approved'
    );

    opportunitySelect.innerHTML = '<option value="" disabled selected>Select an opportunity</option>';

    if (!approved.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No approved applications found';
      option.disabled = true;
      opportunitySelect.appendChild(option);
      setMessage('You need approved applications to log hours', 'error');
      return;
    }

    approved.forEach((app) => {
      const option = document.createElement('option');
      option.value = app.opportunity_id;
      option.textContent = app.opportunity_title || `Opportunity #${app.opportunity_id}`;
      opportunitySelect.appendChild(option);
    });

    setMessage(''); // Clear any previous error messages
  } catch (error) {
    console.error('[LogHours] loadApprovedApplications error:', error);
    opportunitySelect.innerHTML = '<option value="" disabled>Error loading opportunities</option>';
    setMessage('Error loading opportunities', 'error');
  }
}

async function loadRecentHours() {
  if (!hoursTableBody) return;

  try {
    const res = await apiRequest('/hours/my-hours', { method: 'GET' });
    if (!res.ok) {
      hoursTableBody.innerHTML = '<tr><td colspan="4">Failed to load hours</td></tr>';
      return;
    }

    const hours = await res.json();
    const recentHours = hours.slice(0, 10);

    if (!recentHours.length) {
      hoursTableBody.innerHTML = '<tr><td colspan="4">No hours logged yet</td></tr>';
      return;
    }

    hoursTableBody.innerHTML = '';

    recentHours.forEach((entry) => {
      const tr = document.createElement('tr');

      const dateTd = document.createElement('td');
      dateTd.textContent = formatDateOnly(entry.date || entry.created_at) || 'N/A';

      const opportunityTd = document.createElement('td');
      opportunityTd.textContent = entry.opportunity_title || 'N/A';

      const hoursTd = document.createElement('td');
      hoursTd.textContent = entry.hours || 0;

      const statusTd = document.createElement('td');
      statusTd.appendChild(createStatusBadge(entry.approved ? 'approved' : 'pending'));

      tr.appendChild(dateTd);
      tr.appendChild(opportunityTd);
      tr.appendChild(hoursTd);
      tr.appendChild(statusTd);

      hoursTableBody.appendChild(tr);
    });
  } catch (error) {
    console.error('[LogHours] loadRecentHours error:', error);
    hoursTableBody.innerHTML = '<tr><td colspan="4">Error loading hours</td></tr>';
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage('');
  clearFormErrors(logHoursForm);

  if (!logHoursForm || !opportunitySelect || !dateInput || !hoursInput) return;

  const opportunityId = opportunitySelect.value;
  const date = dateInput.value;
  const hours = parseFloat(hoursInput.value);

  if (!opportunityId || !date || isNaN(hours)) {
    const errors = [];
    if (!opportunityId) errors.push({ field: 'opportunityId', message: 'Select an opportunity.' });
    if (!date) errors.push({ field: 'date', message: 'Choose the date you volunteered.' });
    if (isNaN(hours)) errors.push({ field: 'hours', message: 'Enter the number of hours.' });
    showFormErrors(logHoursForm, errors);
    return;
  }

  if (hours < 0.5 || hours > 24) {
    showFormErrors(logHoursForm, [
      { field: 'hours', message: 'Hours must be between 0.5 and 24.' },
    ]);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Logging...';

  try {
    const res = await apiRequest('/hours', {
      method: 'POST',
      body: { opportunityId, date, hours },
    });

    if (!res.ok) {
      const status = res.status;
      const errorBody = await res.json().catch(() => ({}));
      let errorMessage = errorBody?.error || 'Failed to log hours';

      if (status === 403) {
        errorMessage = "You don't have an approved application for this opportunity";
      }

      showFormErrors(logHoursForm, [{ message: errorMessage }]);
      submitButton.disabled = false;
      submitButton.textContent = 'Log Hours';
      return;
    }

    setMessage('Hours logged successfully!', 'success');
    logHoursForm.reset();
    await loadRecentHours();
  } catch (error) {
    console.error('[LogHours] handleSubmit error:', error);
    showFormErrors(logHoursForm, [{ message: 'Network error while logging hours' }]);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Log Hours';
  }
}

function attachEventListeners() {
  if (logHoursForm) {
    logHoursForm.addEventListener('submit', handleSubmit);
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
  setMaxDate();
  attachEventListeners();
  await loadApprovedApplications();
  await loadRecentHours();
}

document.addEventListener('DOMContentLoaded', init);

