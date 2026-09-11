import { apiRequest } from '../config.js';
import { requireAuth } from '../auth.js';

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
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error' : 'success'}">${text}</p>`;
}

function showEmergency(phone) {
  if (!phone) {
    emergencyBanner.hidden = true;
    return;
  }
  emergencyPhoneEl.textContent = phone;
  emergencyBanner.hidden = false;
}

async function loadMatching() {
  const res = await apiRequest('/fosters/matching');
  if (!res.ok) {
    matchingList.innerHTML =
      '<p>Unable to load matching requests. You may need foster approval and home details on your profile.</p>';
    return;
  }
  const data = await res.json();
  showEmergency(data.emergency_phone);
  const requests = data.requests || [];
  if (!requests.length) {
    matchingList.innerHTML =
      '<p>No matching open foster requests right now. Update your foster home details on My profile, and ask staff to mark you foster-approved.</p>';
    return;
  }

  matchingList.innerHTML = '';
  requests.forEach((req) => {
    const article = document.createElement('article');
    const offered = req.my_offer && req.my_offer.status === 'pending';
    article.innerHTML = `
      <header>
        <strong>${req.animal_name || `Animal #${req.animal_id}`}</strong>
        · ${req.urgency}
        · from ${String(req.needed_from || '').slice(0, 10)}
      </header>
      <p>${req.description || 'No description.'}</p>
      ${
        offered
          ? '<p class="success">You have offered to foster.</p>'
          : `<label>Note (optional)
              <textarea class="offer-note" rows="2"></textarea>
            </label>
            <button type="button" class="offer-btn" data-id="${req.id}">Offer to foster</button>`
      }
    `;
    matchingList.appendChild(article);

    const btn = article.querySelector('.offer-btn');
    btn?.addEventListener('click', async () => {
      const note = article.querySelector('.offer-note')?.value || null;
      const offerRes = await apiRequest(`/fosters/requests/${req.id}/offers`, {
        method: 'POST',
        body: { note },
      });
      const body = await offerRes.json().catch(() => ({}));
      if (!offerRes.ok) {
        setMessage('error', body.error || 'Unable to submit offer');
        return;
      }
      setMessage('success', 'Offer submitted. Staff will review and confirm.');
      await loadMatching();
    });
  });
}

async function loadPlacements() {
  const res = await apiRequest('/fosters/my-placements');
  if (!res.ok) {
    placementsList.innerHTML = '<p class="error">Unable to load placements.</p>';
    return;
  }
  const data = await res.json();
  if (data.emergency_phone) showEmergency(data.emergency_phone);
  const placements = data.placements || [];
  if (!placements.length) {
    placementsList.innerHTML = '<p>You have no foster placements yet.</p>';
    return;
  }

  placementsList.innerHTML = '';
  placements.forEach((p) => {
    const article = document.createElement('article');
    const active = p.status === 'active';
    article.innerHTML = `
      <header>
        <strong>${p.animal_name || `Animal #${p.animal_id}`}</strong>
        · ${p.status}
        · started ${String(p.started_on || '').slice(0, 10)}
      </header>
      ${
        p.animal_handling_notes
          ? `<p><strong>Handling notes:</strong> ${p.animal_handling_notes}</p>`
          : ''
      }
      ${
        active
          ? `<div class="form-grid">
              <label>
                Check-in type
                <select class="checkin-type">
                  <option value="other">General check-in</option>
                  <option value="feed">Feed</option>
                  <option value="socialise">Socialise</option>
                  <option value="medical">Medical</option>
                  <option value="walk">Walk</option>
                </select>
              </label>
              <label class="form-full-width">
                Notes
                <textarea class="checkin-notes" rows="2" placeholder="How are they doing?"></textarea>
              </label>
            </div>
            <button type="button" class="checkin-btn" data-id="${p.id}">Log check-in</button>`
          : `<p>Ended ${p.ended_on ? String(p.ended_on).slice(0, 10) : ''}.</p>`
      }
    `;
    placementsList.appendChild(article);

    article.querySelector('.checkin-btn')?.addEventListener('click', async () => {
      const activity_type = article.querySelector('.checkin-type')?.value || 'other';
      const notes = article.querySelector('.checkin-notes')?.value || 'Foster check-in';
      const checkRes = await apiRequest(`/fosters/placements/${p.id}/check-in`, {
        method: 'POST',
        body: { activity_type, notes },
      });
      const body = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok) {
        setMessage('error', body.error || 'Failed to log check-in');
        return;
      }
      setMessage('success', 'Check-in logged.');
      const notesEl = article.querySelector('.checkin-notes');
      if (notesEl) notesEl.value = '';
    });
  });
}

async function init() {
  await requireAuth();
  await loadMatching();
  await loadPlacements();
}

document.addEventListener('DOMContentLoaded', init);
