/**
 * Closure dates (SL-LATER-30). Admins add a closed day or range with a short
 * reason. Staff can see the list and the booked shifts inside a closure.
 * Saving a closure never cancels or emails anyone: booked shifts are listed
 * so staff can close each one through the normal close-shift path.
 */
import { apiRequest } from '../config.js';
import { requireAuth, logout, isAdminRole, isStaffOrAdminRole } from '../auth.js';
import { formatShiftWhen } from '../utils/dateFormat.js';
import { showConfirm } from '../components/confirmDialog.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';
import { formatClosureRange, dayCount } from '../utils/closures.js';

const messageEl = document.getElementById('message');
const form = document.getElementById('closureForm');
const addSection = document.getElementById('addClosureSection');
const startsInput = document.getElementById('starts_on');
const endsInput = document.getElementById('ends_on');
const reasonInput = document.getElementById('reason');
const saveButton = document.getElementById('saveClosureButton');
const closuresBody = document.getElementById('closuresBody');
const affectedSection = document.getElementById('affectedSection');
const affectedHeading = document.getElementById('affectedHeading');
const affectedBody = document.getElementById('affectedBody');

let canEdit = false;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function setMessage(text, tone = 'neutral') {
  if (!text) {
    messageEl.replaceChildren();
    return;
  }
  const cls = tone === 'error' ? 'error-message' : tone === 'success' ? 'success-message' : '';
  messageEl.replaceChildren(el('p', { className: cls, textContent: text }));
}

async function errorText(res, fallback) {
  try {
    const body = await res.json();
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function emptyClosures(text) {
  closuresBody.replaceChildren(el('tr', {}, el('td', { colSpan: 4, textContent: text })));
}

function closeShiftButton(shift, closure) {
  const button = el('button', { type: 'button', className: 'secondary', textContent: 'Close shift' });
  button.addEventListener('click', () => {
    showConfirm({
      heading: `Close "${shift.title}"?`,
      body: 'It disappears from the board and Find shifts. Bookings are kept and nobody is emailed, so tell the volunteers yourself.',
      confirmText: 'Close shift',
      cancelText: 'Keep it open',
      onConfirm: async () => {
        button.disabled = true;
        const res = await apiRequest(`/opportunities/${shift.opportunity_id}`, { method: 'DELETE' });
        if (!res.ok) {
          setMessage(await errorText(res, 'Could not close this shift'), 'error');
          button.disabled = false;
          return;
        }
        setMessage(`Closed "${shift.title}".`, 'success');
        await loadAffected(closure);
      },
    });
  });
  return button;
}

function showAffected(closure, shifts) {
  affectedHeading.textContent = `Booked shifts inside ${formatClosureRange(closure)}`;
  if (!shifts.length) {
    affectedBody.replaceChildren(
      el('tr', {}, el('td', { colSpan: 6, textContent: 'No open shifts with bookings fall inside this closure.' }))
    );
  } else {
    affectedBody.replaceChildren(...shifts.map((shift) => el('tr', {}, [
      el('td', { textContent: shift.title }),
      el('td', { textContent: formatShiftWhen(shift.start_date, shift.end_date) }),
      el('td', { textContent: String(shift.confirmed_count) }),
      el('td', { textContent: String(shift.pending_count) }),
      el('td', { textContent: String(shift.waitlisted_count) }),
      el('td', {}, closeShiftButton(shift, closure)),
    ])));
  }
  affectedSection.hidden = false;
}

async function loadAffected(closure) {
  const res = await apiRequest(`/admin/closures/${closure.id}/affected`, { method: 'GET' });
  if (!res.ok) {
    setMessage(await errorText(res, 'Could not load booked shifts'), 'error');
    return;
  }
  const body = await res.json();
  showAffected(body.closure || closure, Array.isArray(body.affected_shifts) ? body.affected_shifts : []);
}

function removeButton(closure) {
  const button = el('button', { type: 'button', className: 'secondary', textContent: 'Remove' });
  button.addEventListener('click', () => {
    showConfirm({
      heading: `Remove the closure for ${formatClosureRange(closure)}?`,
      body: 'Those days open for new shifts and bookings again.',
      confirmText: 'Remove closure',
      cancelText: 'Keep it',
      onConfirm: async () => {
        button.disabled = true;
        const res = await apiRequest(`/admin/closures/${closure.id}`, { method: 'DELETE' });
        if (!res.ok) {
          setMessage(await errorText(res, 'Could not remove this closure'), 'error');
          button.disabled = false;
          return;
        }
        setMessage(`Removed the closure for ${formatClosureRange(closure)}.`, 'success');
        affectedSection.hidden = true;
        await loadClosures();
      },
    });
  });
  return button;
}

async function loadClosures() {
  try {
    const res = await apiRequest('/admin/closures', { method: 'GET' });
    if (!res.ok) {
      emptyClosures(await errorText(res, 'Could not load closures'));
      return;
    }
    const { closures = [] } = await res.json();
    if (!closures.length) {
      emptyClosures('No closures coming up.');
      return;
    }
    closuresBody.replaceChildren(...closures.map((closure) => {
      const view = el('button', { type: 'button', className: 'secondary', textContent: 'Booked shifts' });
      view.addEventListener('click', () => loadAffected(closure));
      const actions = el('td', { className: 'row-actions' }, [view, canEdit ? removeButton(closure) : null]);
      const days = dayCount(closure);
      return el('tr', {}, [
        el('td', { textContent: formatClosureRange(closure) }),
        el('td', { textContent: `${days} day${days === 1 ? '' : 's'}` }),
        el('td', { textContent: closure.reason }),
        actions,
      ]);
    }));
  } catch (error) {
    emptyClosures(error.message || 'Could not load closures');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  setMessage('');
  const startsOn = startsInput.value;
  const endsOn = endsInput.value || startsOn;
  const reason = reasonInput.value.trim();
  const errors = [];
  if (!startsOn) errors.push({ field: 'starts_on', message: 'Enter the first closed day.' });
  if (startsOn && endsOn < startsOn) {
    errors.push({ field: 'ends_on', message: 'The last closed day must be on or after the first.' });
  }
  if (!reason) errors.push({ field: 'reason', message: 'Enter a short reason, for example Christmas.' });
  if (errors.length) {
    showFormErrors(form, errors);
    return;
  }
  saveButton.disabled = true;
  try {
    const res = await apiRequest('/admin/closures', {
      method: 'POST',
      body: { starts_on: startsOn, ends_on: endsOn, reason },
    });
    if (!res.ok) {
      showFormErrors(form, [{ message: await errorText(res, 'Could not save the closure') }]);
      return;
    }
    const out = await res.json();
    form.reset();
    setMessage(out.message || 'Closure saved.', 'success');
    await loadClosures();
    showAffected(out.closure, Array.isArray(out.affected_shifts) ? out.affected_shifts : []);
  } catch (error) {
    showFormErrors(form, [{ message: error.message || 'Network error. Please try again.' }]);
  } finally {
    saveButton.disabled = false;
  }
});

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  canEdit = isAdminRole(user);
  if (addSection) addSection.hidden = !canEdit;
  document.getElementById('logoutButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    logout();
  });
  await loadClosures();
}

init();
