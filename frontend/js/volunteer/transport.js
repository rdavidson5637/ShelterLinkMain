import { apiRequest } from '../config.js';
import { requireAuth, checkAuth } from '../auth.js';
import { createDateBlock, createEmptyState, createRuledRow, createStatusLabel } from '../components/rows.js';
import { openRowForm, textField } from '../components/rowForm.js';

const messageEl = document.getElementById('message');
const openLegsList = document.getElementById('openLegsList');
const myLegsList = document.getElementById('myLegsList');

function setMessage(type, text) {
  if (!messageEl) return;
  messageEl.replaceChildren();
  if (!text) return;
  const p = document.createElement('p');
  p.className = type === 'error' ? 'error-message' : 'success-message';
  p.textContent = text;
  messageEl.appendChild(p);
}

function legTitle(leg) {
  return `${leg.from_location} to ${leg.to_location}`;
}

function legDetails(leg) {
  const facts = [leg.run_title || 'Transport run'];
  if (leg.animal_name) facts.push(leg.animal_name);
  facts.push(leg.distance_miles != null ? `about ${leg.distance_miles} miles` : 'mileage to be confirmed');
  return facts.join(', ');
}

function rowsList() {
  const list = document.createElement('ul');
  list.className = 'ruled-rows';
  return list;
}

async function openTransportThread(contextId, subject) {
  const res = await apiRequest('/threads', {
    method: 'POST',
    body: {
      context_type: 'transport_run',
      context_id: contextId,
      subject: subject || 'Transport coordination',
      body: 'Hi, I have claimed a leg of this transport run and need to sort out the handover through the shelter.',
    },
  });
  if (res.ok) {
    window.location.href = '/pages/volunteer/messages.html';
    return;
  }
  setMessage('error', 'Could not open message thread. Contact the shelter office.');
}

async function loadOpenLegs() {
  const res = await apiRequest('/transport/legs/open');
  if (!res.ok) {
    openLegsList.replaceChildren(createEmptyState('Transport legs are shown to approved volunteers. Ask staff if you would like to drive.'));
    return;
  }
  const data = await res.json();
  const legs = data.legs || [];
  if (!legs.length) {
    openLegsList.replaceChildren(createEmptyState('No transport legs need a driver right now.'));
    return;
  }
  const list = rowsList();
  legs.forEach((leg) => {
    const claim = document.createElement('button');
    claim.type = 'button';
    claim.className = 'button-small';
    claim.textContent = 'Drive this leg';
    claim.setAttribute('aria-label', `Drive this leg: ${legTitle(leg)}`);
    claim.addEventListener('click', async () => {
      claim.disabled = true;
      const claimRes = await apiRequest(`/transport/legs/${leg.id}/claim`, { method: 'POST', body: {} });
      const body = await claimRes.json().catch(() => ({}));
      claim.disabled = false;
      if (!claimRes.ok) {
        setMessage('error', body.error || 'That leg could not be claimed. Someone may have taken it.');
        return;
      }
      setMessage('success', `You are driving ${legTitle(leg)}. ${body.coordination || 'The shelter will arrange the handover.'}`);
      await loadOpenLegs();
      await loadMyLegs();
    });
    list.appendChild(createRuledRow({
      lead: createDateBlock(leg.run_date),
      title: legTitle(leg),
      details: [legDetails(leg)],
      end: [claim],
    }));
  });
  openLegsList.replaceChildren(list);
}

async function loadMyLegs() {
  const res = await apiRequest('/transport/legs/mine');
  if (!res.ok) {
    myLegsList.replaceChildren(createEmptyState('Your legs could not be loaded. Try again in a minute.'));
    return;
  }
  const data = await res.json();
  const legs = data.legs || [];
  if (!legs.length) {
    myLegsList.replaceChildren(createEmptyState('You are not driving any legs yet.'));
    return;
  }
  const list = rowsList();
  legs.forEach((leg) => {
    const done = Boolean(leg.completed_at);
    const end = [createStatusLabel(done ? 'Done' : 'Coming up', done ? 'ok' : 'brand')];
    const msg = document.createElement('button');
    msg.type = 'button';
    msg.className = 'secondary';
    msg.textContent = 'Message the shelter';
    msg.addEventListener('click', () => openTransportThread(leg.run_id, `Transport: ${leg.run_title || 'run'}`));
    end.push(msg);
    let complete = null;
    if (!done) {
      complete = document.createElement('button');
      complete.type = 'button';
      complete.className = 'button-small';
      complete.textContent = 'Mark as done';
      end.push(complete);
    }
    const row = createRuledRow({
      lead: createDateBlock(leg.run_date),
      title: legTitle(leg),
      details: [legDetails(leg)],
      end,
    });
    complete?.addEventListener('click', () => {
      openRowForm(row, () => {
        const field = textField('Miles driven (optional)', 'leg-miles');
        const input = field.querySelector('input');
        input.inputMode = 'decimal';
        if (leg.distance_miles != null) input.value = String(leg.distance_miles);
        return [field];
      }, 'Save', async (form) => {
        const raw = form.querySelector('.leg-miles')?.value.trim();
        const miles = raw ? Number(raw) : null;
        if (raw && !Number.isFinite(miles)) {
          setMessage('error', 'Miles should be a number, for example 12.5.');
          return;
        }
        const completeRes = await apiRequest(`/transport/legs/${leg.id}/complete`, { method: 'POST', body: { distance_miles: miles } });
        if (!completeRes.ok) {
          const body = await completeRes.json().catch(() => ({}));
          setMessage('error', body.error || 'That did not save. Try again in a moment.');
          return;
        }
        setMessage('success', `${legTitle(leg)} marked as done. Thank you.`);
        await loadMyLegs();
      });
    });
    list.appendChild(row);
  });
  myLegsList.replaceChildren(list);
}

async function init() {
  await requireAuth();
  await checkAuth();
  await loadOpenLegs();
  await loadMyLegs();
}

init();
