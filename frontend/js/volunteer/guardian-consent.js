// Parent or guardian consent for volunteers under 18 (SL-NOW-02).
// The section stays hidden unless this shelter needs consent from this volunteer.
import { apiRequest } from '../config.js';
import { showFormErrors, clearFormErrors } from '../utils/formErrors.js';

const section = document.getElementById('guardianConsentSection');
const form = document.getElementById('guardianConsentForm');
const intro = document.getElementById('guardianConsentIntro');
const statusEl = document.getElementById('guardianConsentStatus');
const submit = document.getElementById('guardianConsentSubmit');

function setStatus(type, text) {
  if (!statusEl) return;
  statusEl.replaceChildren();
  if (!text) return;
  const p = document.createElement('p');
  p.className = type === 'error' ? 'error' : 'success';
  p.textContent = text;
  statusEl.appendChild(p);
}

function formatDay(value) {
  if (!value) return '';
  const day = String(value).slice(0, 10);
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function render(status) {
  if (!section || !status) return;

  if (status.under_min_age) {
    section.hidden = false;
    form.hidden = true;
    intro.textContent = `This shelter's minimum volunteer age is ${status.min_volunteer_age}. You can book shifts once you turn ${status.min_volunteer_age}.`;
    setStatus('', '');
    return;
  }

  if (!status.consent_required) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  if (status.consent) {
    form.hidden = true;
    const c = status.consent;
    setStatus(
      'success',
      `${c.guardian_name} (${c.guardian_relationship}) gave consent on ${formatDay(c.consented_at)}. You can book shifts.`
    );
  } else {
    form.hidden = false;
    setStatus('', '');
  }
}

async function load() {
  if (!section) return;
  try {
    const res = await apiRequest('/volunteer/profile/age', { method: 'GET' });
    if (!res.ok) return;
    render(await res.json());
  } catch {
    // The rest of the profile page still works without this section.
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  setStatus('', '');
  const data = new FormData(form);
  const payload = {
    guardian_name: String(data.get('guardian_name') || '').trim(),
    guardian_relationship: String(data.get('guardian_relationship') || '').trim(),
    guardian_phone: String(data.get('guardian_phone') || '').trim() || null,
    guardian_email: String(data.get('guardian_email') || '').trim() || null,
  };
  if (data.get('confirm')) payload.confirm = true;

  submit.disabled = true;
  try {
    const res = await apiRequest('/volunteer/profile/guardian-consent', {
      method: 'POST',
      body: payload,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.fields) {
        const fieldIds = { confirm: 'guardian_confirm' };
        showFormErrors(
          form,
          Object.entries(body.fields).map(([field, message]) => ({
            field: fieldIds[field] || field,
            message,
          }))
        );
      } else {
        setStatus('error', body.error || 'Consent could not be recorded. Try again.');
      }
      return;
    }
    form.reset();
    await load();
  } catch (error) {
    setStatus('error', error.message || 'Consent could not be recorded. Try again.');
  } finally {
    submit.disabled = false;
  }
});

load();
