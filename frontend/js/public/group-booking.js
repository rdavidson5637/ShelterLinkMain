const form = document.getElementById('groupBookingForm');
const opportunitySelect = document.getElementById('opportunityId');
const messageEl = document.getElementById('message');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function formatDate(value) {
  if (!value) return 'Date TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleString();
}

async function loadOpportunities() {
  if (!opportunitySelect) return;
  try {
    const res = await fetch('/api/public/opportunities', { credentials: 'omit' });
    if (!res.ok) throw new Error('Failed to load');
    const rows = await res.json();
    opportunitySelect.innerHTML = '<option value="">Select an opportunity</option>';
    if (!Array.isArray(rows) || !rows.length) {
      opportunitySelect.innerHTML = '<option value="">No open opportunities</option>';
      return;
    }
    rows.forEach((opp) => {
      const opt = document.createElement('option');
      opt.value = opp.id;
      const spots =
        opp.spots_remaining == null ? 'unlimited' : `${opp.spots_remaining} spots left`;
      opt.textContent = `${opp.title || 'Shift'} — ${formatDate(opp.date || opp.start_date)} (${spots})`;
      opportunitySelect.appendChild(opt);
    });

    const params = new URLSearchParams(window.location.search);
    const preselect = params.get('opportunity_id');
    if (preselect) opportunitySelect.value = preselect;
  } catch (error) {
    console.error('[GroupBooking] load opportunities error:', error);
    opportunitySelect.innerHTML = '<option value="">Unable to load opportunities</option>';
  }
}

async function submitForm(event) {
  event.preventDefault();
  setMessage('');
  const payload = {
    opportunity_id: Number(opportunitySelect.value),
    group_name: document.getElementById('groupName').value.trim(),
    contact_name: document.getElementById('contactName').value.trim(),
    contact_email: document.getElementById('contactEmail').value.trim(),
    size: Number(document.getElementById('groupSize').value),
    notes: document.getElementById('notes').value.trim() || null,
  };

  try {
    const res = await fetch('/api/group-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error || 'Unable to submit group booking', 'error');
      return;
    }
    form.reset();
    await loadOpportunities();
    setMessage('Request submitted. We will email you when it is reviewed.', 'success');
  } catch (error) {
    console.error('[GroupBooking] submit error:', error);
    setMessage('Network error while submitting.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadOpportunities();
  if (form) form.addEventListener('submit', submitForm);
});
