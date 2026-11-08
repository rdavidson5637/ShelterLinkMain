/**
 * Public shelter application form at /apply.
 * Suggests a web address from the shelter name until the person edits it,
 * checks the obvious mistakes in the browser, and shows the server's
 * field errors next to the right field.
 */
import { apiRequest } from '/js/config.js';
import { showFormErrors, clearFormErrors } from '/js/utils/formErrors.js';

const form = document.getElementById('applyForm');
const heading = document.getElementById('heading');
const intro = document.getElementById('intro');
const messageEl = document.getElementById('message');
const submitButton = document.getElementById('submitButton');
const nameInput = document.getElementById('shelter_name');
const slugInput = document.getElementById('desired_slug');
const slugPreview = document.getElementById('slugPreview');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = { ccni: /^NIC\d{6}$/, ccew: /^\d{6,7}(-\d{1,3})?$/ };

export function slugFromName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

let slugEdited = false;

function updatePreview() {
  slugPreview.textContent = `/s/${slugInput.value || 'your-shelter'}`;
}

nameInput.addEventListener('input', () => {
  if (!slugEdited) {
    slugInput.value = slugFromName(nameInput.value);
    updatePreview();
  }
});

slugInput.addEventListener('input', () => {
  slugEdited = true;
  slugInput.value = slugInput.value.toLowerCase().replace(/\s+/g, '-');
  updatePreview();
});

function value(id) {
  return document.getElementById(id).value.trim();
}

function localErrors(data) {
  const errors = [];
  if (data.shelter_name.length < 2) errors.push({ field: 'shelter_name', message: "Enter your shelter's name." });
  if (data.desired_slug.length < 3 || !SLUG_RE.test(data.desired_slug)) {
    errors.push({ field: 'desired_slug', message: 'Use at least 3 lowercase letters and numbers, with single hyphens between words.' });
  }
  if (!data.regulator) errors.push({ field: 'regulator', message: 'Choose which regulator your charity is registered with.' });
  else if (!NUMBER_RE[data.regulator].test(data.charity_number.replace(/\s+/g, '').toUpperCase())) {
    errors.push({
      field: 'charity_number',
      message: data.regulator === 'ccni'
        ? 'Northern Ireland charity numbers start with NIC followed by 6 digits, for example NIC100001.'
        : 'England and Wales charity numbers are 6 or 7 digits, for example 1234567.',
    });
  }
  if (data.contact_name.length < 2) errors.push({ field: 'contact_name', message: 'Enter your name.' });
  if (!EMAIL_RE.test(data.contact_email)) errors.push({ field: 'contact_email', message: 'Enter an email address like name@example.org.' });
  return errors;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  messageEl.replaceChildren();

  const data = {
    shelter_name: value('shelter_name'),
    desired_slug: value('desired_slug'),
    regulator: value('regulator'),
    charity_number: value('charity_number'),
    contact_name: value('contact_name'),
    contact_email: value('contact_email'),
    website: document.getElementById('website').value,
  };

  const errors = localErrors(data);
  if (errors.length) {
    showFormErrors(form, errors);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';
  try {
    const res = await apiRequest('/public/shelter-applications', { method: 'POST', body: data });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.hidden = true;
      heading.textContent = 'Application sent';
      intro.textContent = body.message || 'Thanks. Your application is with us.';
      return;
    }
    const message = body.error || (res.status === 429 ? 'Too many attempts. Please try again later.' : 'Something went wrong. Please try again.');
    showFormErrors(form, [{ field: body.field || undefined, message }]);
  } catch {
    showFormErrors(form, [{ message: 'Network error. Please check your connection and try again.' }]);
  }
  submitButton.disabled = false;
  submitButton.textContent = 'Send application';
});
