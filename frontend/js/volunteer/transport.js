import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout } from '../auth.js';

const messageEl = document.getElementById('message');
const openLegsList = document.getElementById('openLegsList');
const myLegsList = document.getElementById('myLegsList');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error' : 'success'}">${text}</p>`;
}

function formatLeg(leg) {
  const when = leg.run_date ? String(leg.run_date).slice(0, 10) : '';
  const animal = leg.animal_name ? ` · ${leg.animal_name}` : '';
  return `${leg.run_title || 'Transport'} (${when})${animal}: ${leg.from_location} → ${leg.to_location}`;
}

async function openTransportThread(contextId, subject) {
  const res = await apiRequest('/threads', {
    method: 'POST',
    body: {
      context_type: 'transport_run',
      context_id: contextId,
      subject: subject || 'Transport coordination',
      body: 'Hi — I claimed a leg on this transport run and need to coordinate handover via the shelter.',
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
    openLegsList.innerHTML = '<p class="error">Unable to load open legs. Approved volunteers only.</p>';
    return;
  }
  const data = await res.json();
  const legs = data.legs || [];
  if (!legs.length) {
    openLegsList.innerHTML = '<p>No open transport legs right now.</p>';
    return;
  }
  openLegsList.innerHTML = '';
  legs.forEach((leg) => {
    const article = document.createElement('article');
    article.innerHTML = `
      <header><strong></strong></header>
      <p></p>
      <button type="button" class="claim-btn">Claim this leg</button>
    `;
    article.querySelector('strong').textContent = formatLeg(leg);
    article.querySelector('p').textContent =
      leg.distance_miles != null ? `About ${leg.distance_miles} miles` : 'Mileage TBC';
    article.querySelector('.claim-btn').addEventListener('click', async () => {
      const claimRes = await apiRequest(`/transport/legs/${leg.id}/claim`, {
        method: 'POST',
        body: {},
      });
      const body = await claimRes.json().catch(() => ({}));
      if (!claimRes.ok) {
        setMessage('error', body.error || 'Could not claim leg');
        return;
      }
      const prev = body.previous_leg?.exists
        ? ` Previous leg exists (order ${body.previous_leg.leg_order}).`
        : '';
      const next = body.next_leg?.exists
        ? ` Next leg exists (order ${body.next_leg.leg_order}).`
        : '';
      setMessage(
        'success',
        `Leg claimed.${prev}${next} ${body.coordination || 'Coordinate via shelter.'}`
      );
      await loadOpenLegs();
      await loadMyLegs();
    });
    openLegsList.appendChild(article);
  });
}

async function loadMyLegs() {
  const res = await apiRequest('/transport/legs/mine');
  if (!res.ok) {
    myLegsList.innerHTML = '<p class="error">Unable to load your legs.</p>';
    return;
  }
  const data = await res.json();
  const legs = data.legs || [];
  if (!legs.length) {
    myLegsList.innerHTML = '<p>You have not claimed any legs yet.</p>';
    return;
  }
  myLegsList.innerHTML = '';
  legs.forEach((leg) => {
    const article = document.createElement('article');
    const done = Boolean(leg.completed_at);
    article.innerHTML = `
      <header><strong></strong></header>
      <p></p>
      <p class="muted">Coordinate via shelter · message thread available</p>
      <div class="actions"></div>
    `;
    article.querySelector('strong').textContent = formatLeg(leg);
    article.querySelector('p').textContent = done
      ? `Completed ${String(leg.completed_at).replace('T', ' ').slice(0, 16)}`
      : 'In progress';
    const actions = article.querySelector('.actions');
    const msgBtn = document.createElement('button');
    msgBtn.type = 'button';
    msgBtn.className = 'secondary';
    msgBtn.textContent = 'Message thread';
    msgBtn.addEventListener('click', () =>
      openTransportThread(leg.run_id, `Transport: ${leg.run_title || 'run'}`)
    );
    actions.appendChild(msgBtn);
    if (!done) {
      const completeBtn = document.createElement('button');
      completeBtn.type = 'button';
      completeBtn.textContent = 'Mark complete';
      completeBtn.addEventListener('click', async () => {
        const miles = window.prompt('Actual miles (optional):', leg.distance_miles || '');
        const completeRes = await apiRequest(`/transport/legs/${leg.id}/complete`, {
          method: 'POST',
          body: {
            distance_miles: miles === null || miles === '' ? null : Number(miles),
          },
        });
        if (!completeRes.ok) {
          const body = await completeRes.json().catch(() => ({}));
          setMessage('error', body.error || 'Could not complete leg');
          return;
        }
        setMessage('success', 'Leg marked complete.');
        await loadMyLegs();
      });
      actions.appendChild(document.createTextNode(' '));
      actions.appendChild(completeBtn);
    }
    myLegsList.appendChild(article);
  });
}

async function init() {
  await requireAuth();
  await checkAuth();
  await loadOpenLegs();
  await loadMyLegs();
}

init();
