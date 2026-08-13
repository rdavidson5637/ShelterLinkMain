/**
 * Reusable accessible Opportunity Details Modal.
 * Used in Browse Shifts and Calendar (import only — no duplicated logic).
 * Modal text ≥ 16px, buttons ≥ 48px, labelled actions (no icon-only controls).
 */

const PROFILE_URL = '/pages/volunteer/complete-profile.html';

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** e.g. "Mon 3 Feb – Fri 7 Feb 2025" (not ISO) */
function formatSingleDate(d) {
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const day = d.getDate();
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  const year = d.getFullYear();
  return `${weekday} ${day} ${month} ${year}`;
}

function formatDateRange(startStr, endStr) {
  if (!startStr) return 'Dates to be confirmed';
  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return 'Dates to be confirmed';
  const end = endStr && endStr !== startStr ? new Date(endStr) : start;
  const endValid = !Number.isNaN(end.getTime()) ? end : start;
  if (start.getTime() === endValid.getTime()) return formatSingleDate(start);
  return `${formatSingleDate(start)} – ${formatSingleDate(endValid)}`;
}

function getSpotsText(spotsFilled, spotsTotal) {
  if (spotsTotal == null || spotsTotal === '' || !Number.isFinite(Number(spotsTotal))) {
    return 'Open — no limit';
  }
  const filled = Number(spotsFilled) || 0;
  const total = Number(spotsTotal);
  return `${filled} of ${total} spots filled`;
}

function createModalElement() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'opportunity-modal-title');
  dialog.setAttribute('aria-describedby', 'opportunity-modal-body');
  dialog.setAttribute('aria-modal', 'true');
  dialog.className = 'opportunity-modal-dialog';

  dialog.innerHTML = `
    <div class="opportunity-modal-card" role="document">
      <div class="opportunity-modal-header">
        <h2 id="opportunity-modal-title" class="opportunity-modal-title"></h2>
        <button type="button" class="opportunity-modal-close" aria-label="Close"><span aria-hidden="true">×</span></button>
      </div>
      <div id="opportunity-modal-body" class="opportunity-modal-body">
        <p class="opportunity-modal-line opportunity-modal-location-line"></p>
        <p class="opportunity-modal-line opportunity-modal-dates-line"></p>
        <p class="opportunity-modal-line opportunity-modal-hours-line" hidden></p>
        <p class="opportunity-modal-line opportunity-modal-spots-line"></p>
        <section class="opportunity-modal-section opportunity-modal-desc-section" aria-label="Description">
          <h3 class="opportunity-modal-section-heading"><span aria-hidden="true">📋</span> Description</h3>
          <div class="opportunity-modal-description"></div>
        </section>
        <section class="opportunity-modal-section opportunity-modal-req-section" hidden aria-label="Requirements">
          <h3 class="opportunity-modal-section-heading"><span aria-hidden="true">✅</span> Requirements</h3>
          <div class="opportunity-modal-requirements"></div>
        </section>
        <section class="opportunity-modal-section opportunity-modal-quals-section" hidden aria-label="Required qualifications">
          <h3 class="opportunity-modal-section-heading"><span aria-hidden="true">🎓</span> Required qualifications</h3>
          <div class="opportunity-modal-qualifications"></div>
        </section>
      </div>
      <div class="opportunity-modal-footer">
        <div class="opportunity-modal-actions"></div>
      </div>
    </div>
  `;

  return dialog;
}

let modalEl = null;
let previousActiveElement = null;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

function handleDocumentKeydown(e) {
  if (!modalEl || !modalEl.open) return;

  /* Escape closes <dialog> natively; focus is restored in the close listener. */

  if (e.key !== 'Tab') return;

  const card = modalEl.querySelector('.opportunity-modal-card');
  const list = getFocusableElements(card);
  if (!list.length) return;

  const first = list[0];
  const last = list[list.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function handleBackdropClick(e) {
  if (e.target === modalEl) hideOpportunityModal();
}

function attachGlobalHandlersOnce() {
  if (!modalEl || modalEl.dataset.handlersBound === '1') return;
  modalEl.dataset.handlersBound = '1';
  modalEl.addEventListener('click', handleBackdropClick);
  document.addEventListener('keydown', handleDocumentKeydown);
}

export function showOpportunityModal(opportunity, options = {}) {
  if (!opportunity) return;

  const {
    hasApplied = false,
    isFull = false,
    profileApproved = true,
    spotsFilled,
    spotsTotal,
    missingQualifications = [],
    onApply,
  } = options;

  if (!modalEl) {
    modalEl = createModalElement();
    modalEl.addEventListener('close', () => {
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        try {
          previousActiveElement.focus();
        } catch (_) {
          /* ignore if node detached */
        }
      }
      previousActiveElement = null;
    });
    document.body.appendChild(modalEl);
    attachGlobalHandlersOnce();
  }

  const id = opportunity.opportunityId ?? opportunity.id ?? opportunity.opportunity_id;
  const title = opportunity.title || 'Volunteer Shift';
  const location = opportunity.location || 'Location to be confirmed';
  const startDate = opportunity.start_date ?? opportunity.start;
  const endDate = opportunity.end_date ?? opportunity.end ?? startDate;
  const description = opportunity.description || 'No description provided.';
  const requirements = opportunity.requirements || '';
  const hoursPerWeek = opportunity.hours_per_week ?? opportunity.hoursPerWeek;
  const maxVolunteers = opportunity.max_volunteers ?? opportunity.maxVolunteers ?? spotsTotal;
  const filled = spotsFilled ?? opportunity.spots_filled ?? opportunity.spotsFilled;

  const maxNum =
    maxVolunteers != null && maxVolunteers !== '' && Number.isFinite(Number(maxVolunteers))
      ? Number(maxVolunteers)
      : null;
  const filledNum = Number(filled) || 0;
  const fullByCapacity = maxNum != null && maxNum > 0 && filledNum >= maxNum;
  const shiftFull = Boolean(isFull || opportunity.status === 'closed' || fullByCapacity);

  modalEl.querySelector('.opportunity-modal-title').textContent = title;

  const locLine = modalEl.querySelector('.opportunity-modal-location-line');
  locLine.innerHTML = `<span aria-hidden="true">📍</span> <strong>Location:</strong> ${escapeHtml(location)}`;

  const datesLine = modalEl.querySelector('.opportunity-modal-dates-line');
  datesLine.innerHTML = `<span aria-hidden="true">📅</span> <strong>Dates:</strong> ${escapeHtml(formatDateRange(startDate, endDate))}`;

  const hoursLine = modalEl.querySelector('.opportunity-modal-hours-line');
  if (hoursPerWeek != null && hoursPerWeek !== '') {
    hoursLine.innerHTML = `<span aria-hidden="true">⏰</span> <strong>Hours per week:</strong> ${escapeHtml(String(hoursPerWeek))}`;
    hoursLine.hidden = false;
  } else {
    hoursLine.hidden = true;
  }

  const spotsLine = modalEl.querySelector('.opportunity-modal-spots-line');
  spotsLine.innerHTML = `<span aria-hidden="true">👥</span> <strong>Spots:</strong> ${escapeHtml(getSpotsText(filled, maxVolunteers))}`;

  const safeDesc = escapeHtml(description).replace(/\n/g, '</p><p>');
  modalEl.querySelector('.opportunity-modal-description').innerHTML = `<p>${safeDesc}</p>`;

  const reqSection = modalEl.querySelector('.opportunity-modal-req-section');
  const reqBody = modalEl.querySelector('.opportunity-modal-requirements');
  if (requirements && String(requirements).trim()) {
    const safeReq = escapeHtml(requirements).replace(/\n/g, '</p><p>');
    reqBody.innerHTML = `<p>${safeReq}</p>`;
    reqSection.hidden = false;
  } else {
    reqBody.innerHTML = '';
    reqSection.hidden = true;
  }

  const qualsSection = modalEl.querySelector('.opportunity-modal-quals-section');
  const qualsBody = modalEl.querySelector('.opportunity-modal-qualifications');
  const requiredQuals = opportunity.required_qualifications || [];
  if (requiredQuals.length) {
    const names = requiredQuals.map((q) => escapeHtml(q.name)).join(', ');
    let html = `<p>requires: ${names}</p>`;
    if (missingQualifications.length) {
      html += `<p class="opportunity-modal-unqualified">You are missing: ${missingQualifications
        .map((q) => escapeHtml(q.name))
        .join(', ')}</p>`;
    }
    qualsBody.innerHTML = html;
    qualsSection.hidden = false;
  } else {
    qualsBody.innerHTML = '';
    qualsSection.hidden = true;
  }

  const actionsContainer = modalEl.querySelector('.opportunity-modal-actions');
  actionsContainer.innerHTML = '';

  let actionButton;
  const unqualified = Array.isArray(missingQualifications) && missingQualifications.length > 0;

  if (hasApplied) {
    actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'opportunity-modal-btn opportunity-modal-btn-disabled';
    actionButton.textContent = 'Already Applied';
    actionButton.disabled = true;
  } else if (!profileApproved) {
    actionButton = document.createElement('a');
    actionButton.href = PROFILE_URL;
    actionButton.className = 'opportunity-modal-btn opportunity-modal-btn-profile';
    actionButton.textContent = 'Complete Your Profile First';
    actionButton.addEventListener('click', () => hideOpportunityModal());
  } else if (unqualified) {
    actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'opportunity-modal-btn opportunity-modal-btn-disabled';
    actionButton.textContent = 'Missing required qualifications';
    actionButton.disabled = true;
  } else if (shiftFull) {
    actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'opportunity-modal-btn opportunity-modal-btn-apply';
    actionButton.textContent = 'Join waitlist';
    actionButton.addEventListener('click', () => {
      if (onApply) onApply(opportunity, id, { waitlist: true });
    });
  } else {
    actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'opportunity-modal-btn opportunity-modal-btn-apply';
    actionButton.textContent = 'Apply for this Shift';
    actionButton.addEventListener('click', () => {
      if (onApply) onApply(opportunity, id, { waitlist: false });
    });
  }

  actionsContainer.appendChild(actionButton);

  const closeBtn = modalEl.querySelector('.opportunity-modal-close');
  closeBtn.onclick = hideOpportunityModal;

  previousActiveElement = document.activeElement;
  modalEl.showModal();
  closeBtn.focus();
}

export function hideOpportunityModal() {
  if (!modalEl) return;
  modalEl.close();
}
