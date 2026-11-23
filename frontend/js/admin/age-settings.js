// Shelter minimum volunteer age (SL-NOW-02). Staff can read it; admins set it.
import { apiRequest } from '../config.js';
import { checkAuth, isAdminRole } from '../auth.js';

const form = document.getElementById('ageSettingsForm');
const input = document.getElementById('min_volunteer_age');
const summary = document.getElementById('ageSettingsSummary');
const saveButton = document.getElementById('ageSettingsSave');

function describe(settings) {
  const min = settings.min_volunteer_age;
  if (min == null) {
    return 'No minimum set. Volunteers of any age can book; under-18s need guardian consent first.';
  }
  if (min >= 18) {
    return `Adults only: volunteers must be ${min} or over on the shift date.`;
  }
  return `Volunteers must be ${min} or over on the shift date. Those aged ${min} to 17 need guardian consent first.`;
}

function show(settings) {
  input.value = settings.min_volunteer_age == null ? '' : String(settings.min_volunteer_age);
  summary.textContent = describe(settings);
  summary.classList.remove('error');
}

async function load() {
  if (!form) return;
  const user = await checkAuth();
  const admin = isAdminRole(user);
  input.disabled = !admin;
  if (saveButton) saveButton.hidden = !admin;
  try {
    const res = await apiRequest('/admin/settings/age', { method: 'GET' });
    if (!res.ok) {
      summary.textContent = 'Could not load the minimum age.';
      return;
    }
    show(await res.json());
  } catch {
    summary.textContent = 'Could not load the minimum age.';
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = input.value.trim();
  const value = raw === '' ? null : Number(raw);
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 99)) {
    summary.textContent = 'Enter a whole number from 1 to 99, or leave it empty for no minimum.';
    summary.classList.add('error');
    input.focus();
    return;
  }
  saveButton.disabled = true;
  try {
    const res = await apiRequest('/admin/settings/age', {
      method: 'PUT',
      body: { min_volunteer_age: value },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      summary.textContent = body.error || 'Could not save the minimum age.';
      summary.classList.add('error');
      return;
    }
    show(body);
    summary.textContent = `Saved. ${describe(body)}`;
  } catch (error) {
    summary.textContent = error.message || 'Could not save the minimum age.';
    summary.classList.add('error');
  } finally {
    saveButton.disabled = false;
  }
});

load();
