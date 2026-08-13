import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { showOpportunityModal, hideOpportunityModal } from '../components/opportunityModal.js';

const calendarEl = document.getElementById('calendar');
const calendarEmptyState = document.getElementById('calendarEmptyState');
const logoutButton = document.getElementById('logoutButton');
const viewMonthButton = document.getElementById('viewMonthButton');
const viewWeekButton = document.getElementById('viewWeekButton');
const viewListButton = document.getElementById('viewListButton');

let calendar = null;
let myApplications = [];
let profileApproved = true;

function isOpportunityFull(opportunity) {
  if (opportunity.status === 'closed') return true;
  const maxVolunteers = Number(opportunity.max_volunteers ?? opportunity.maxVolunteers);
  const spotsFilled = Number(opportunity.spots_filled ?? opportunity.spotsFilled ?? 0);
  if (!Number.isFinite(maxVolunteers) || maxVolunteers <= 0) return false;
  return spotsFilled >= maxVolunteers;
}

function getEventColor(opportunity, appliedIds) {
  const id = opportunity.id ?? opportunity.opportunity_id;
  if (appliedIds.has(id)) return '#1976d2';
  if (isOpportunityFull(opportunity)) return '#9e9e9e';
  return '#4caf50';
}

function mapOpportunitiesToEvents(opportunities, appliedIds) {
  return opportunities.map((opp) => {
    const id = opp.id ?? opp.opportunity_id;
    const title = opp.title || 'Volunteer Shift';
    const location = opp.location || '';
    const startDate = opp.start_date || opp.start;
    const endDate = opp.end_date || opp.end || startDate;
    const color = getEventColor(opp, appliedIds);

    const startDay = String(startDate || '').slice(0, 10);
    const endDay = String(endDate || '').slice(0, 10) || startDay;
    const safeEndDay = endDay >= startDay ? endDay : startDay;
    const isSingleDay = safeEndDay === startDay;

    // Use all-day events in month/week views; this avoids timezone shifts and
    // respects actual calendar dates. FullCalendar treats `end` as exclusive.
    const start = startDay;
    let end;
    if (!isSingleDay) {
      const endDateObj = new Date(`${safeEndDay}T00:00:00`);
      endDateObj.setDate(endDateObj.getDate() + 1);
      end = endDateObj.toISOString().slice(0, 10);
    }

    return {
      id: String(id),
      title: `${title}${location ? ` • ${location}` : ''}`,
      start,
      ...(end ? { end } : {}),
      allDay: true,
      color,
      extendedProps: { ...opp, opportunityId: id },
    };
  });
}

function openOpportunityModal(opportunity) {
  const id = opportunity.opportunityId ?? opportunity.id ?? opportunity.opportunity_id;
  const hasApplied = myApplications.some(
    (a) => String(a.opportunity_id ?? a.opportunityId) === String(id)
  );
  const isFull = isOpportunityFull(opportunity);
  const maxVol = opportunity.max_volunteers ?? opportunity.maxVolunteers;

  showOpportunityModal(opportunity, {
    hasApplied,
    isFull,
    profileApproved,
    spotsFilled: opportunity.spots_filled ?? opportunity.spotsFilled,
    spotsTotal: maxVol,
    onApply: handleApplyFromModal,
  });
}

async function handleApplyFromModal(opportunity, id, options = {}) {
  const waitlist = Boolean(options.waitlist);
  const confirmed = window.confirm(
    waitlist ? 'Join the waitlist for this shift?' : 'Apply for this shift?'
  );
  if (!confirmed) return;

  try {
    const res = await apiRequest('/applications', {
      method: 'POST',
      body: { opportunityId: id },
    });

    if (res.status === 201) {
      const body = await res.json().catch(() => ({}));
      myApplications.push({
        opportunity_id: id,
        status: body.status || (waitlist ? 'waitlisted' : 'pending'),
      });
      hideOpportunityModal();
      await loadAndRenderCalendar();
      return;
    }

    if (res.status === 409) {
      myApplications.push({ opportunity_id: id, status: 'pending' });
      hideOpportunityModal();
      await loadAndRenderCalendar();
      return;
    }

    const err = await res.json().catch(() => ({}));
    alert(err?.error || 'Unable to apply. Please try again.');
  } catch (error) {
    console.error('[Calendar] apply error:', error);
    alert('Network error. Please try again.');
  }
}

async function fetchOpportunities() {
  const res = await apiRequest('/opportunities', { method: 'GET' });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchMyApplications() {
  const res = await apiRequest('/applications/my-applications', { method: 'GET' });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function getAppliedOpportunityIds(applications) {
  return new Set(
    applications.map((a) => String(a.opportunity_id ?? a.opportunityId ?? a.id)).filter(Boolean)
  );
}

async function loadAndRenderCalendar() {
  const [opportunities, applications] = await Promise.all([
    fetchOpportunities(),
    fetchMyApplications(),
  ]);

  myApplications = applications;
  const appliedIds = getAppliedOpportunityIds(applications);
  const events = mapOpportunitiesToEvents(opportunities, appliedIds);

  if (calendarEmptyState) {
    calendarEmptyState.style.display = opportunities.length === 0 ? 'block' : 'none';
  }
  if (calendarEl) {
    calendarEl.style.display = opportunities.length === 0 ? 'none' : '';
  }

  if (calendar) {
    calendar.removeAllEvents();
    events.forEach((ev) => calendar.addEvent(ev));
  }
}

function switchView(viewName) {
  if (!calendar) return;
  calendar.changeView(viewName);
  viewMonthButton?.classList.toggle('secondary', viewName !== 'dayGridMonth');
  viewMonthButton?.classList.toggle('contrast', viewName === 'dayGridMonth');
  viewWeekButton?.classList.toggle('secondary', viewName !== 'dayGridWeek');
  viewWeekButton?.classList.toggle('contrast', viewName === 'dayGridWeek');
  viewListButton?.classList.toggle('secondary', viewName !== 'listMonth');
  viewListButton?.classList.toggle('contrast', viewName === 'listMonth');
}

function initCalendar() {
  if (!calendarEl || typeof FullCalendar === 'undefined') return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: '',
    },
    events: [],
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      openOpportunityModal(info.event.extendedProps);
    },
    eventDisplay: 'block',
    height: 'auto',
    dayMaxEvents: 3,
    eventDidMount: (info) => {
      info.el.setAttribute('role', 'button');
      info.el.setAttribute('tabindex', '0');
      const props = info.event.extendedProps || {};
      const isRepeating =
        (props.recurrence_rule && props.recurrence_rule !== 'none') ||
        Boolean(props.parent_opportunity_id);
      const repeatHint = isRepeating ? ' Repeats.' : '';
      info.el.title = `${info.event.title}${repeatHint}`;
      info.el.setAttribute(
        'aria-label',
        `${info.event.title}.${repeatHint} Click to view details.`
      );
      info.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openOpportunityModal(info.event.extendedProps);
        }
      });
    },
  });

  calendar.render();

  viewMonthButton?.addEventListener('click', () => switchView('dayGridMonth'));
  viewWeekButton?.addEventListener('click', () => switchView('dayGridWeek'));
  viewListButton?.addEventListener('click', () => switchView('listMonth'));

  viewMonthButton?.classList.add('contrast');
}

async function init() {
  await requireAuth();

  try {
    const profileRes = await apiRequest('/volunteer/profile', { method: 'GET' });
    if (profileRes?.ok) {
      const profile = await profileRes.json().catch(() => ({}));
      profileApproved = Boolean(profile?.approved);
    }
  } catch {
    profileApproved = false;
  }

  initCalendar();
  await loadAndRenderCalendar();

  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);