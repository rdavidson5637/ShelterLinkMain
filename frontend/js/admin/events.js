import { apiRequest } from '../config.js';
import { requireAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showConfirm } from '../components/confirmDialog.js';

const messageEl = document.getElementById('message');
const listEl = document.getElementById('eventList');
const form = document.getElementById('eventForm');
const showAllEl = document.getElementById('showAll');
const logoutButton = document.getElementById('logoutButton');
const attendeeSection = document.getElementById('attendeeSection');
const attendeeHeading = document.getElementById('attendeeHeading');
const attendeeList = document.getElementById('attendeeList');

let selectedEventId = null;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.dataset.tone = tone;
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function renderItems(items) {
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = '<p class="event-empty">No events yet.</p>';
    return;
  }

  listEl.innerHTML = `<ul class="event-ruled-list">${items
    .map((item) => {
      const status = escapeHtml(item.status || 'upcoming');
      const date = formatDate(item.event_date);
      const filled = Number(item.spots_filled) || 0;
      const capacity = Number(item.capacity) || 0;
      const emailed = item.emailed_at
        ? `Emailed ${escapeHtml(String(item.email_count || 0))} on ${escapeHtml(
            String(item.emailed_at).slice(0, 10)
          )}`
        : 'Not emailed';
      const canAct = item.status === 'upcoming';
      const selected = String(item.id) === String(selectedEventId) ? ' data-selected="1"' : '';
      return `<li data-id="${item.id}"${selected}>
        <div class="event-ruled-main">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.description)}</p>
          <p class="event-meta">
            ${escapeHtml(date)} · ${escapeHtml(item.location || '')}
            · ${filled} of ${capacity} places
            · ${status}
            · ${emailed}
          </p>
        </div>
        <div class="event-ruled-actions">
          <button type="button" class="secondary" data-action="attendees">Attendees</button>
          ${
            canAct
              ? `<button type="button" class="secondary" data-action="email">Email attendees</button>
                 <button type="button" class="secondary" data-action="archive">Archive</button>`
              : item.status === 'past' && !item.archived_at
                ? `<button type="button" class="secondary" data-action="archive">Archive</button>`
                : ''
          }
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderAttendees(event, attendees) {
  if (!attendeeSection || !attendeeList || !attendeeHeading) return;
  attendeeSection.hidden = false;
  attendeeHeading.textContent = `Attendees · ${event?.title || 'Event'}`;
  if (!attendees.length) {
    attendeeList.innerHTML = '<p class="event-empty">Nobody has signed up yet.</p>';
    return;
  }
  attendeeList.innerHTML = `<ul class="event-attendee-ruled">${attendees
    .map((person) => {
      const name = escapeHtml(person.name || 'Volunteer');
      const email = person.email ? escapeHtml(person.email) : 'No email';
      return `<li>
        <strong>${name}</strong>
        <span class="event-meta">${email}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

async function loadList() {
  const showAll = Boolean(showAllEl?.checked);
  const query = showAll ? '?all=1' : '';
  const res = await apiRequest(`/events${query}`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load events');
  }
  const data = await res.json();
  renderItems(Array.isArray(data.items) ? data.items : []);
}

async function loadAttendees(id) {
  selectedEventId = id;
  const res = await apiRequest(`/events/${id}/attendees`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load attendees');
  }
  const data = await res.json();
  renderAttendees(data.item, Array.isArray(data.attendees) ? data.attendees : []);
  await loadList();
}

async function onSubmit(event) {
  event.preventDefault();
  const title = document.getElementById('event_title')?.value?.trim() || '';
  const description = document.getElementById('event_description')?.value?.trim() || '';
  const event_date = document.getElementById('event_date')?.value || '';
  const location = document.getElementById('event_location')?.value?.trim() || '';
  const capacityRaw = document.getElementById('event_capacity')?.value;
  const capacity = Number(capacityRaw);

  const payload = { title, description, event_date, location, capacity };
  const res = await apiRequest('/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not create event', 'error');
    return;
  }
  form?.reset();
  if (document.getElementById('event_capacity')) {
    document.getElementById('event_capacity').value = '20';
  }
  setMessage('Event created. Volunteers can sign up from Events.', 'success');
  await loadList();
}

async function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !listEl?.contains(button)) return;
  const row = button.closest('li[data-id]');
  const id = row?.getAttribute('data-id');
  if (!id) return;
  const action = button.getAttribute('data-action');

  if (action === 'attendees') {
    await loadAttendees(id);
    return;
  }

  if (action === 'archive') {
    const ok = await showConfirm({
      title: 'Archive this event?',
      message:
        'Volunteers will no longer see it for sign-up. You can still find it under Show past and archived.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    const res = await apiRequest(`/events/${id}/archive`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err.error || 'Could not archive', 'error');
      return;
    }
    setMessage('Event archived.', 'success');
    if (String(selectedEventId) === String(id) && attendeeSection) {
      attendeeSection.hidden = true;
      selectedEventId = null;
    }
    await loadList();
    return;
  }

  if (action === 'email') {
    const ok = await showConfirm({
      title: 'Email attendees?',
      message:
        'This sends an email only to people currently signed up for this event. Cancelled sign-ups are skipped. Email only.',
      confirmLabel: 'Send email',
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const res = await apiRequest(`/events/${id}/email`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || 'Could not send email', 'error');
        return;
      }
      setMessage(data.message || 'Email sent.', 'success');
      await loadList();
    } finally {
      button.disabled = false;
    }
  }
}

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  if (logoutButton) logoutButton.addEventListener('click', () => logout());
  form?.addEventListener('submit', (event) => {
    onSubmit(event).catch((error) => {
      console.error('[Events] create error:', error);
      setMessage(error.message || 'Could not create event', 'error');
    });
  });
  listEl?.addEventListener('click', (event) => {
    onListClick(event).catch((error) => {
      console.error('[Events] action error:', error);
      setMessage(error.message || 'Action failed', 'error');
    });
  });
  showAllEl?.addEventListener('change', () => {
    loadList().catch((error) => {
      setMessage(error.message || 'Could not load events', 'error');
    });
  });

  try {
    await loadList();
  } catch (error) {
    console.error('[Events] load error:', error);
    setMessage(error.message || 'Could not load events', 'error');
    if (listEl) listEl.innerHTML = '<p class="event-empty">Could not load events.</p>';
  }
}

init();
