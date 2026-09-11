import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility} from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const headerCheckbox = document.getElementById('headerCheckbox');
const bulkApproveButton = document.getElementById('bulkApproveButton');
const hoursTableBody = document.getElementById('hoursTableBody');
const logoutButton = document.getElementById('logoutButton');

let pendingHours = [];

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function getSelectedIds() {
  const checkboxes = hoursTableBody.querySelectorAll('input[type="checkbox"][data-hours-id]');
  const selected = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) {
      selected.push(Number(cb.dataset.hoursId));
    }
  });
  return selected;
}

function updateSelectAllState() {
  const checkboxes = hoursTableBody.querySelectorAll('input[type="checkbox"][data-hours-id]');
  const checkedCount = Array.from(checkboxes).filter((cb) => cb.checked).length;
  const allChecked = checkboxes.length > 0 && checkedCount === checkboxes.length;

  if (selectAllCheckbox) selectAllCheckbox.checked = allChecked;
  if (headerCheckbox) headerCheckbox.checked = allChecked;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 1rem;
    right: 1rem;
    padding: 1rem;
    background: ${type === 'success' ? '#4caf50' : '#f44336'};
    color: white;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 3000);
}

function updatePendingCount() {
  const count = pendingHours.length;
  const countEl = document.getElementById('pendingCount');
  if (countEl) {
    countEl.textContent = count;
  }
}

function removeRow(hoursId) {
  const row = hoursTableBody.querySelector(`tr[data-hours-id="${hoursId}"]`);
  if (row) {
    row.remove();
  }
  pendingHours = pendingHours.filter((h) => h.id !== hoursId);
  updatePendingCount();

  if (pendingHours.length === 0) {
    hoursTableBody.innerHTML = '<tr><td colspan="6">No pending hours to approve</td></tr>';
  }
}

function renderTable() {
  if (!hoursTableBody) return;

  if (!pendingHours.length) {
    hoursTableBody.innerHTML = '<tr><td colspan="6">No pending hours to approve</td></tr>';
    updatePendingCount();
    return;
  }

  hoursTableBody.innerHTML = '';

  pendingHours.forEach((entry) => {
    const tr = document.createElement('tr');
    tr.dataset.hoursId = entry.id;

    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.hoursId = entry.id;
    checkbox.addEventListener('change', updateSelectAllState);
    checkboxTd.appendChild(checkbox);

    const nameTd = document.createElement('td');
    const fullName = `${entry.first_name || ''} ${entry.last_name || ''}`.trim() || 'N/A';
    nameTd.textContent = fullName;

    const opportunityTd = document.createElement('td');
    opportunityTd.textContent = entry.opportunity_title || 'N/A';

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDateOnly(entry.date || entry.created_at) || 'N/A';

    const hoursTd = document.createElement('td');
    hoursTd.textContent = entry.hours || 0;
    if (entry.verified_by_checkin) {
      const mark = document.createElement('div');
      mark.textContent = 'verified by check-in';
      mark.style.cssText = 'font-size:0.75rem;color:#1565c0;';
      hoursTd.appendChild(mark);
    }

    const actionsTd = document.createElement('td');
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.textContent = entry.verified_by_checkin ? 'Fast-approve' : 'Approve';
    approveBtn.classList.add('contrast', 'button-small');
    approveBtn.addEventListener('click', () => handleApprove(entry.id));
    actionsTd.appendChild(approveBtn);

    tr.appendChild(checkboxTd);
    tr.appendChild(nameTd);
    tr.appendChild(opportunityTd);
    tr.appendChild(dateTd);
    tr.appendChild(hoursTd);
    tr.appendChild(actionsTd);

    hoursTableBody.appendChild(tr);
  });

  updatePendingCount();
}

async function handleApprove(hoursId) {
  const row = hoursTableBody.querySelector(`tr[data-hours-id="${hoursId}"]`);
  const approveBtn = row?.querySelector('button');
  
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = 'Approving...';
  }

  try {
    const res = await apiRequest(`/hours/${hoursId}/approve`, {
      method: 'PUT',
    });

    if (!res.ok) {
      showToast('Failed to approve hours', 'error');
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.textContent = 'Approve';
      }
      return;
    }

    showToast('Hours approved successfully', 'success');
    removeRow(hoursId);
  } catch (error) {
    console.error('[ApproveHours] handleApprove error:', error);
    showToast('Network error while approving hours', 'error');
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.textContent = 'Approve';
    }
  }
}

async function handleBulkApprove() {
  const selectedIds = getSelectedIds();
  if (!selectedIds.length) {
    showToast('Please select at least one entry to approve', 'error');
    return;
  }

  if (!confirm(`Approve ${selectedIds.length} hour entry/entries?`)) {
    return;
  }

  bulkApproveButton.disabled = true;
  const originalText = bulkApproveButton.textContent;
  bulkApproveButton.textContent = `Approving 0/${selectedIds.length}...`;

  try {
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedIds.length; i++) {
      const id = selectedIds[i];
      bulkApproveButton.textContent = `Approving ${i + 1}/${selectedIds.length}...`;

      try {
        const res = await apiRequest(`/hours/${id}/approve`, {
          method: 'PUT',
        });
        if (res.ok) {
          successCount++;
          removeRow(id);
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(`[ApproveHours] Failed to approve ${id}:`, error);
        failCount++;
      }
    }

    if (failCount === 0) {
      showToast(`Successfully approved ${successCount} hour entry/entries`, 'success');
    } else {
      showToast(`Approved ${successCount}, failed ${failCount}`, 'error');
    }
  } catch (error) {
    console.error('[ApproveHours] handleBulkApprove error:', error);
    showToast('Error during bulk approval', 'error');
  } finally {
    bulkApproveButton.disabled = false;
    bulkApproveButton.textContent = originalText;
  }
}

async function loadPendingHours() {
  if (!hoursTableBody) return;

  try {
    const res = await apiRequest('/hours/pending', { method: 'GET' });
    if (!res.ok) {
      hoursTableBody.innerHTML = '<tr><td colspan="6">Failed to load pending hours</td></tr>';
      setMessage('Failed to load pending hours', 'error');
      return;
    }

    pendingHours = await res.json();
    renderTable();
    updatePendingCount();
    setMessage('');
  } catch (error) {
    console.error('[ApproveHours] loadPendingHours error:', error);
    hoursTableBody.innerHTML = '<tr><td colspan="6">Error loading pending hours</td></tr>';
    setMessage('Error loading pending hours', 'error');
  }
}

function attachEventListeners() {
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const checkboxes = hoursTableBody.querySelectorAll('input[type="checkbox"][data-hours-id]');
      checkboxes.forEach((cb) => {
        cb.checked = e.target.checked;
      });
      if (headerCheckbox) headerCheckbox.checked = e.target.checked;
    });
  }

  if (headerCheckbox) {
    headerCheckbox.addEventListener('change', (e) => {
      const checkboxes = hoursTableBody.querySelectorAll('input[type="checkbox"][data-hours-id]');
      checkboxes.forEach((cb) => {
        cb.checked = e.target.checked;
      });
      if (selectAllCheckbox) selectAllCheckbox.checked = e.target.checked;
    });
  }

  if (bulkApproveButton) {
    bulkApproveButton.addEventListener('click', handleBulkApprove);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
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

async function init() {
  await requireAuth();
  await enforceAdmin();
  attachEventListeners();
  await loadPendingHours();
}

document.addEventListener('DOMContentLoaded', init);

