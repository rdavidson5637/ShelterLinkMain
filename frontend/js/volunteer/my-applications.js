import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { showConfirm } from '../components/confirmDialog.js';
import { formatShiftWhen, formatDateOnly } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';

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

function createStatusBadgeForApp(status = '', waitlistPosition = null) {
  const suffix = waitlistPosition ? ` (#${waitlistPosition})` : '';
  return createStatusBadge(status, { suffix });
}

async function loadAnimalsForApplication(app, container) {
  const oppId = app.opportunity_id;
  if (!oppId || !container) return;
  const res = await apiRequest(`/opportunities/${oppId}`);
  if (!res.ok) {
    container.innerHTML = '';
    return;
  }
  const opp = await res.json();
  const animals = opp.animals || [];
  if (!animals.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';
  const heading = document.createElement('p');
  heading.style.fontWeight = '600';
  heading.textContent = 'Animals on this shift';
  container.appendChild(heading);

  animals.forEach((animal) => {
    const block = document.createElement('div');
    block.style.cssText =
      'margin:0.5rem 0;padding:0.65rem 0.85rem;border:1px solid var(--border-color,#ddd);border-radius:6px;';
    const title = document.createElement('strong');
    title.textContent = animal.name;
    block.appendChild(title);
    if (animal.handling_notes) {
      const notes = document.createElement('p');
      notes.style.cssText = 'margin:0.35rem 0;font-size:0.9rem;';
      notes.textContent = `Handling: ${animal.handling_notes}`;
      block.appendChild(notes);
    }
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;margin-top:0.35rem;';
    ['walk', 'feed', 'socialise'].forEach((type) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      btn.addEventListener('click', async () => {
        try {
          const logRes = await apiRequest(`/animals/${animal.id}/activity`, {
            method: 'POST',
            body: {
              application_id: app.id || app.application_id,
              activity_type: type,
            },
          });
          if (!logRes.ok) {
            const err = await logRes.json().catch(() => ({}));
            showToast(err?.error || 'Could not log activity', 'error');
            return;
          }
          showToast(`Logged ${type} for ${animal.name}`);
        } catch {
          showToast('Could not log activity', 'error');
        }
      });
      actions.appendChild(btn);
    });
    block.appendChild(actions);
    container.appendChild(block);
  });
}

async function loadShiftNotesForApplication(app, container) {
  const oppId = app.opportunity_id;
  if (!oppId || !container) return;
  const res = await apiRequest(`/opportunities/${oppId}/notes`);
  if (!res.ok) {
    container.innerHTML = '';
    return;
  }
  const notes = await res.json();
  if (!Array.isArray(notes) || !notes.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = '';
  const heading = document.createElement('p');
  heading.style.fontWeight = '600';
  heading.textContent = 'Shift notes';
  container.appendChild(heading);
  notes.forEach((note) => {
    const block = document.createElement('div');
    block.style.cssText =
      'margin:0.35rem 0;padding:0.5rem 0.75rem;border-left:3px solid #1b5e20;background:#f6f7f6;';
    const meta = document.createElement('small');
    meta.style.display = 'block';
    meta.style.color = 'var(--text-muted)';
    const when = note.created_at
      ? new Date(note.created_at).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    meta.textContent = `${note.author_name || 'Staff'}${when ? ` · ${when}` : ''}`;
    const body = document.createElement('p');
    body.style.margin = '0.25rem 0 0';
    body.textContent = note.body;
    block.appendChild(meta);
    block.appendChild(body);
    container.appendChild(block);
  });
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

    const badge = createStatusBadgeForApp(app.status, app.waitlist_position);

    header.appendChild(title);
    header.appendChild(badge);

    const meta = document.createElement('p');
    const location = app.opportunity_location || 'Location TBA';
    const dates = formatShiftWhen(app.opportunity_start_date, app.opportunity_end_date);
    meta.textContent = `${location}${dates ? ` • ${dates}` : ''}`;

    const appliedAt = document.createElement('p');
    appliedAt.style.fontSize = '0.875rem';
    appliedAt.style.color = 'var(--text-muted)';
    appliedAt.textContent = `Applied ${formatDateOnly(app.created_at)}`;

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

    if (isAccepted) {
      const animalWrap = document.createElement('div');
      animalWrap.style.cssText = 'margin-top:0.75rem;';
      animalWrap.dataset.animalSlot = '1';
      animalWrap.innerHTML = '<p style="font-size:0.875rem;color:var(--text-muted)">Loading animals…</p>';
      card.appendChild(animalWrap);
      loadAnimalsForApplication(app, animalWrap).catch(() => {
        animalWrap.innerHTML = '';
      });

      const chatBtn = document.createElement('button');
      chatBtn.type = 'button';
      chatBtn.className = 'secondary';
      chatBtn.textContent = 'Open shift chat';
      chatBtn.style.marginTop = '0.5rem';
      chatBtn.addEventListener('click', async () => {
        try {
          const { openShiftChat, messagesPageHref } = await import('../components/threadsUi.js');
          const thread = await openShiftChat(app.opportunity_id, {
            subject: app.opportunity_title || `Shift chat #${app.opportunity_id}`,
          });
          window.location.href = messagesPageHref(thread.id);
        } catch (error) {
          showToast(error.message || 'Could not open shift chat', 'error');
        }
      });
      card.appendChild(chatBtn);
    }

    if (isAccepted) {
      const notesWrap = document.createElement('div');
      notesWrap.style.cssText = 'margin-top:0.75rem;';
      notesWrap.innerHTML =
        '<p style="font-size:0.875rem;color:var(--text-muted)">Loading shift notes…</p>';
      card.appendChild(notesWrap);
      loadShiftNotesForApplication(app, notesWrap).catch(() => {
        notesWrap.innerHTML = '';
      });
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
              badge.className = 'badge badge--cancelled';
              badge.textContent = 'Cancelled';
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
