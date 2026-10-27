import { apiRequest } from '../config.js';
import { requireAuth } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { createDateBlock, createEmptyState, createRuledRow, createStatusLabel } from '../components/rows.js';
import { openRowForm, textField } from '../components/rowForm.js';

const messageEl = document.getElementById('message');
const matchingList = document.getElementById('matchingList');
const placementsList = document.getElementById('placementsList');
const emergencyBanner = document.getElementById('emergencyBanner');
const emergencyPhoneEl = document.getElementById('emergencyPhone');

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error-message' : 'success-message'}">${escapeHtml(text)}</p>`;
}

function showEmergency(phone) {
  if (!phone) {
    emergencyBanner.hidden = true;
    return;
  }
  emergencyPhoneEl.textContent = phone;
  emergencyBanner.hidden = false;
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function formatDay(value) {
  const iso = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return DAY.format(new Date(y, m - 1, d));
}

function plainEmpty(container, sentence, action) {
  container.replaceChildren(createEmptyState(sentence, action));
}

async function loadMatching() {
  const res = await apiRequest('/fosters/matching');
  if (!res.ok) {
    plainEmpty(matchingList, 'Foster requests are shown once staff have approved you as a foster carer and your home details are on your profile.', {
      href: '/pages/volunteer/complete-profile.html#fosterHomeSection',
      label: 'Add your home details',
    });
    return;
  }
  const data = await res.json();
  showEmergency(data.emergency_phone);
  const requests = data.requests || [];
  if (!requests.length) {
    plainEmpty(matchingList, 'No foster requests match your home right now.');
    return;
  }

  const list = document.createElement('ul');
  list.className = 'ruled-rows';
  requests.forEach((req) => {
    const offered = req.my_offer && req.my_offer.status === 'pending';
    const from = formatDay(req.needed_from);
    const end = [];
    if (req.urgency === 'urgent') end.push(createStatusLabel('Urgent', 'pending'));
    if (offered) {
      end.push(createStatusLabel('You offered', 'ok'));
    } else {
      const offer = document.createElement('button');
      offer.type = 'button';
      offer.className = 'button-small';
      offer.textContent = 'Offer to foster';
      end.push(offer);
    }
    const name = req.animal_name || `Animal ${req.animal_id}`;
    const row = createRuledRow({
      lead: createDateBlock(req.needed_from),
      title: name,
      details: [from ? `Needed from ${from}` : 'Start date to be agreed', req.description || ''],
      end,
      needsYou: req.urgency === 'urgent' && !offered,
    });
    row.querySelector('.ruled-row-end button')?.addEventListener('click', () => {
      openRowForm(row, () => [textField('Anything staff should know? (optional)', 'offer-note', 'For example, home all day on weekends')], 'Send offer', async (form) => {
        const note = form.querySelector('.offer-note')?.value.trim() || null;
        const offerRes = await apiRequest(`/fosters/requests/${req.id}/offers`, { method: 'POST', body: { note } });
        const body = await offerRes.json().catch(() => ({}));
        if (!offerRes.ok) {
          setMessage('error', body.error || 'Your offer did not go through. Try again in a moment.');
          return;
        }
        setMessage('success', `Offer sent for ${name}. Staff will confirm.`);
        await loadMatching();
      });
    });
    list.appendChild(row);
  });
  matchingList.replaceChildren(list);
}

async function loadPlacements() {
  const res = await apiRequest('/fosters/my-placements');
  if (!res.ok) {
    plainEmpty(placementsList, 'Your foster placements could not be loaded. Try again in a minute.');
    return;
  }
  const data = await res.json();
  if (data.emergency_phone) showEmergency(data.emergency_phone);
  const placements = data.placements || [];
  if (!placements.length) {
    plainEmpty(placementsList, 'No animals are staying with you yet.');
    return;
  }

  const list = document.createElement('ul');
  list.className = 'ruled-rows';
  placements.forEach((p) => {
    const active = p.status === 'active';
    const name = p.animal_name || `Animal ${p.animal_id}`;
    const started = formatDay(p.started_on);
    const ended = formatDay(p.ended_on);
    const details = [active ? (started ? `With you since ${started}` : 'With you now') : (ended ? `Went home ${ended}` : 'Placement ended')];
    // Handling notes are staff-written text: always set as text, never HTML.
    if (p.animal_handling_notes) details.push(`Handling: ${p.animal_handling_notes}`);
    const end = [createStatusLabel(active ? 'With you' : 'Ended', active ? 'ok' : 'neutral')];
    if (active) {
      const log = document.createElement('button');
      log.type = 'button';
      log.className = 'button-small';
      log.textContent = 'Log a check-in';
      end.push(log);
    }
    const row = createRuledRow({ lead: createDateBlock(p.started_on), title: name, details, end });
    row.querySelector('.ruled-row-end button')?.addEventListener('click', () => {
      openRowForm(row, () => {
        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'What did you do?';
        const select = document.createElement('select');
        select.className = 'checkin-type';
        [['other', 'General check-in'], ['feed', 'Feed'], ['walk', 'Walk'], ['socialise', 'Play or socialise'], ['medical', 'Medicine or vet']].forEach(([value, label]) => {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = label;
          select.appendChild(opt);
        });
        typeLabel.appendChild(select);
        return [typeLabel, textField(`How is ${name} doing?`, 'checkin-notes', 'For example, eating well, a bit shy')];
      }, 'Save check-in', async (form) => {
        const activity_type = form.querySelector('.checkin-type')?.value || 'other';
        const notes = form.querySelector('.checkin-notes')?.value.trim() || 'Foster check-in';
        const checkRes = await apiRequest(`/fosters/placements/${p.id}/check-in`, { method: 'POST', body: { activity_type, notes } });
        const body = await checkRes.json().catch(() => ({}));
        if (!checkRes.ok) {
          setMessage('error', body.error || 'The check-in did not save. Try again in a moment.');
          return;
        }
        setMessage('success', `Check-in saved for ${name}.`);
        await loadPlacements();
      });
    });
    list.appendChild(row);
  });
  placementsList.replaceChildren(list);
}

async function init() {
  await requireAuth();
  await loadMatching();
  await loadPlacements();
}

document.addEventListener('DOMContentLoaded', init);
