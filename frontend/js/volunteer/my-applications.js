import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { showConfirm } from '../components/confirmDialog.js';

const applicationsContainer = document.getElementById('applications-container');
const filterTabs = document.getElementById('filterTabs');
const logoutButton = document.getElementById('logoutButton');

let allApplications = [];
let currentFilter = 'all';

function setMessage(text) {
  if (!applicationsContainer) return;
  applicationsContainer.innerHTML = `<p>${text}</p>`;
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
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => document.body.removeChild(toast), 3000);
}

function createStatusBadge(status = '', waitlistPosition = null) {
  const badge = document.createElement('span');
  const tone = (status || '').toLowerCase();
  const display = {
    cancelled: 'Cancelled',
    pending: 'Pending',
    approved: 'Approved',
    accepted: 'Approved',
    rejected: 'Rejected',
    waitlisted: waitlistPosition
      ? `Waitlisted (#${waitlistPosition})`
      : 'Waitlisted',
  }[tone] || (status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Unknown');
  badge.textContent = display;
  badge.classList.add('badge');
  const colors = {
    pending: '#e3a008',
    approved: '#0f9d58',
    accepted: '#0f9d58',
    rejected: '#d93025',
    cancelled: '#6c757d',
    waitlisted: '#1565c0',
  };
  badge.style.backgroundColor = colors[tone] || '#6c757d';
  badge.style.color = '#fff';
  badge.style.padding = '0.15rem 0.5rem';
  badge.style.borderRadius = '999px';
  badge.style.fontSize = '0.85em';
  return badge;
}

function renderApplications() {
  if (!applicationsContainer) return;
  applicationsContainer.innerHTML = '';

  const filtered = allApplications.filter((app) => {
    if (currentFilter === 'all') return true;
    const s = (app.status || '').toLowerCase();
    if (currentFilter === 'approved') return s === 'approved' || s === 'accepted';
    return s === currentFilter;
  });

  if (!filtered.length) {
    setMessage(
      currentFilter === 'all'
        ? "You haven't applied to any shifts yet"
        : 'No applications found for this filter.'
    );
    return;
  }

  filtered.forEach((app) => {
    const card = document.createElement('article');
    card.dataset.applicationId = app.id;

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const title = document.createElement('h3');
    title.textContent = app.opportunity_title || 'Volunteer Opportunity';

    const badge = createStatusBadge(app.status, app.waitlist_position);

    header.appendChild(title);
    header.appendChild(badge);

    const meta = document.createElement('p');
    const location = app.opportunity_location || 'Location TBA';
    const dates = [app.opportunity_start_date, app.opportunity_end_date].filter(Boolean).join(' - ');
    meta.textContent = `${location}${dates ? ` • ${dates}` : ''}`;

    const appliedAt = document.createElement('p');
    appliedAt.style.fontSize = '0.875rem';
    appliedAt.style.color = '#666';
    appliedAt.textContent = `Applied: ${app.created_at || ''}`;

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(appliedAt);

    const statusLower = (app.status || '').toLowerCase();

    // Check-in / check-out on shift day for accepted applications
    const isAccepted = statusLower === 'accepted' || statusLower === 'approved';
    const startDay = String(app.opportunity_start_date || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (isAccepted && startDay && startDay === today) {
      const checkInWrap = document.createElement('div');
      checkInWrap.style.cssText = 'margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;';

      if (!app.checked_in_at) {
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.maxLength = 6;
        codeInput.placeholder = 'Check-in code';
        codeInput.setAttribute('aria-label', 'Check-in code');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Check in';
        btn.addEventListener('click', async () => {
          const code = codeInput.value.trim();
          if (!code) return;
          try {
            const res = await apiRequest(`/applications/${app.id}/check-in`, {
              method: 'POST',
              body: { code },
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              showToast(err?.error || 'Check-in failed', 'error');
              return;
            }
            showToast('Checked in');
            await fetchApplications();
          } catch (e) {
            showToast('Check-in failed', 'error');
          }
        });
        checkInWrap.appendChild(codeInput);
        checkInWrap.appendChild(btn);
      } else if (!app.checked_out_at) {
        const checked = document.createElement('span');
        checked.textContent = 'Checked in';
        checked.style.color = '#0f9d58';
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.maxLength = 6;
        codeInput.placeholder = 'Code to check out';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Check out';
        btn.addEventListener('click', async () => {
          const code = codeInput.value.trim();
          if (!code) return;
          try {
            const res = await apiRequest(`/applications/${app.id}/check-out`, {
              method: 'POST',
              body: { code },
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              showToast(err?.error || 'Check-out failed', 'error');
              return;
            }
            showToast('Checked out — hours submitted for approval');
            await fetchApplications();
          } catch (e) {
            showToast('Check-out failed', 'error');
          }
        });
        checkInWrap.appendChild(checked);
        checkInWrap.appendChild(codeInput);
        checkInWrap.appendChild(btn);
      } else {
        const done = document.createElement('span');
        done.textContent = 'Checked out';
        done.style.color = '#0f9d58';
        checkInWrap.appendChild(done);
      }
      card.appendChild(checkInWrap);
    }

    // Show rejection reason if present
    if (statusLower === 'rejected' && app.rejection_reason) {
      const reasonBox = document.createElement('div');
      reasonBox.style.cssText = `
        margin-top: 0.75rem;
        padding: 0.65rem 0.85rem;
        background: #fff3f3;
        border-left: 3px solid #d93025;
        border-radius: 4px;
        font-size: 0.9rem;
      `;
      const reasonLabel = document.createElement('strong');
      reasonLabel.textContent = 'Reason: ';
      const reasonText = document.createTextNode(app.rejection_reason);
      reasonBox.appendChild(reasonLabel);
      reasonBox.appendChild(reasonText);
      card.appendChild(reasonBox);
    }

    // General notes (non-rejection)
    if (app.notes && statusLower !== 'rejected') {
      const notes = document.createElement('p');
      notes.style.fontSize = '0.9rem';
      notes.textContent = `Notes: ${app.notes}`;
      card.appendChild(notes);
    }

    function isWithinCutoff(appRow) {
      const start = appRow.opportunity_start_date;
      if (!start) return false;
      const startDate = new Date(start);
      if (Number.isNaN(startDate.getTime())) return false;
      const cutoff = Number(appRow.cancellation_cutoff_hours ?? 24);
      const safeCutoff = Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : 24;
      return startDate.getTime() - Date.now() <= safeCutoff * 60 * 60 * 1000;
    }

    const canCancel =
      statusLower === 'pending' ||
      statusLower === 'waitlisted' ||
      ((statusLower === 'approved' || statusLower === 'accepted') && !isWithinCutoff(app));

    if (canCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'secondary button-secondary';
      cancelBtn.textContent = 'Cancel Application';
      cancelBtn.style.cssText = 'border: 2px solid #ff9800; color: #e65100; margin-top: 0.5rem;';
      cancelBtn.addEventListener('click', () => {
        showConfirm({
          heading: 'Cancel this application?',
          body: 'You can apply again later if the shift is still open.',
          confirmText: 'Yes, Cancel Application',
          cancelText: 'Keep Application',
          onConfirm: async () => {
            try {
              const res = await apiRequest(`/applications/${app.id}`, { method: 'DELETE' });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err?.error || 'Failed to cancel application.', 'error');
                return;
              }
              app.status = 'cancelled';
              badge.textContent = 'Cancelled';
              badge.style.backgroundColor = '#6c757d';
              cancelBtn.remove();
              showToast('Application cancelled. You can apply again later.');
            } catch (e) {
              console.error('[Volunteer] cancel application error:', e);
              showToast('Failed to cancel application.', 'error');
            }
          },
        });
      });
      card.appendChild(cancelBtn);
    }

    if (isAccepted && isWithinCutoff(app) && !app.open_swap_id) {
      const swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.className = 'secondary button-secondary';
      swapBtn.textContent = 'Request swap';
      swapBtn.style.cssText = 'border: 2px solid #1565c0; color: #0d47a1; margin-top: 0.5rem; margin-left: 0.5rem;';
      swapBtn.addEventListener('click', () => {
        showConfirm({
          heading: 'Request a shift swap?',
          body: 'Other qualifying volunteers will be offered the chance to cover this shift. Inside the cancellation window you cannot cancel directly.',
          confirmText: 'Request Swap',
          cancelText: 'Keep Shift',
          onConfirm: async () => {
            try {
              const res = await apiRequest(`/applications/${app.id}/swap`, { method: 'POST' });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) {
                showToast(body?.error || 'Failed to open swap.', 'error');
                return;
              }
              app.open_swap_id = body.swap?.id;
              swapBtn.remove();
              showToast(body.message || 'Swap request opened.');
              await fetchApplications();
            } catch (e) {
              console.error('[Volunteer] request swap error:', e);
              showToast('Failed to open swap.', 'error');
            }
          },
        });
      });
      card.appendChild(swapBtn);
    } else if (isAccepted && app.open_swap_id) {
      const swapNote = document.createElement('p');
      swapNote.style.cssText = 'margin-top:0.5rem;font-size:0.9rem;color:#1565c0;';
      swapNote.textContent = 'Swap request open — waiting for cover.';
      card.appendChild(swapNote);
    }

    if (statusLower === 'accepted' || statusLower === 'approved') {
      const calLink = document.createElement('a');
      calLink.href = `/api/applications/${app.id}/ics`;
      calLink.textContent = 'Add to calendar';
      calLink.className = 'secondary';
      calLink.style.cssText = 'display:inline-block;margin-top:0.5rem;margin-left:0.5rem;';
      card.appendChild(calLink);
    }

    applicationsContainer.appendChild(card);
  });
}

function attachFilterHandlers() {
  if (!filterTabs) return;
  const buttons = filterTabs.querySelectorAll('button[data-status]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('contrast'));
      btn.classList.add('contrast');
      currentFilter = btn.dataset.status || 'all';
      renderApplications();
    });
  });
  const defaultTab = filterTabs.querySelector('button[data-status="all"]');
  if (defaultTab) defaultTab.classList.add('contrast');
}

async function fetchApplications() {
  if (!applicationsContainer) return;
  setMessage('Loading applications...');
  try {
    const res = await apiRequest('/applications/my-applications', { method: 'GET' });
    if (!res.ok) {
      setMessage('Failed to load applications.');
      return;
    }
    allApplications = await res.json();
    renderApplications();
  } catch (error) {
    console.error('[Volunteer] fetchApplications error:', error);
    setMessage('Network error while loading applications.');
  }
}

function attachLogout() {
  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }
}

async function init() {
  await requireAuth();
  attachFilterHandlers();
  attachLogout();
  await fetchApplications();
}

document.addEventListener('DOMContentLoaded', init);
