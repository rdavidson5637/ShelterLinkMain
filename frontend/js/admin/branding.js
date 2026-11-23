import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';
import { applyShelterBrand } from '../brand.js';
import { withShelterQuery } from '../shelterSlug.js';

const colourForm = document.getElementById('colourForm');
const colourInput = document.getElementById('primary_colour');
const colourPicker = document.getElementById('primary_colour_picker');
const colourSave = document.getElementById('colourSave');
const colourClear = document.getElementById('colourClear');
const colourStatus = document.getElementById('colourStatus');
const colourPreview = document.getElementById('colourPreview');
const colourSwatch = document.getElementById('colourSwatch');
const colourPreviewText = document.getElementById('colourPreviewText');
const defaultColourLabel = document.getElementById('defaultColourLabel');

const logoForm = document.getElementById('logoForm');
const logoInput = document.getElementById('logo');
const logoSave = document.getElementById('logoSave');
const logoStatus = document.getElementById('logoStatus');
const logoPreviewWrap = document.getElementById('logoPreviewWrap');
const logoPreview = document.getElementById('logoPreview');

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function setStatus(el, text, isError) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', Boolean(isError));
}

function syncPickerFromHex(hex) {
  if (!colourPicker) return;
  if (HEX_RE.test(hex)) colourPicker.value = hex.toLowerCase();
}

function showColourPreview(hex, tokens) {
  if (!colourPreview || !hex) {
    colourPreview?.setAttribute('hidden', '');
    return;
  }
  colourPreview.hidden = false;
  if (colourSwatch) colourSwatch.style.background = hex;
  if (colourPreviewText) {
    colourPreviewText.textContent = tokens
      ? `Active accent ${hex}`
      : `Saved ${hex} (pages use the default until contrast passes)`;
  }
}

function showLogo(hasLogo) {
  if (!logoPreviewWrap || !logoPreview) return;
  if (!hasLogo) {
    logoPreviewWrap.hidden = true;
    logoPreview.removeAttribute('src');
    return;
  }
  logoPreviewWrap.hidden = false;
  const base = withShelterQuery('/api/public/brand/logo');
  const sep = base.includes('?') ? '&' : '?';
  logoPreview.src = `${base}${sep}t=${Date.now()}`;
}

function applyToPage(settings) {
  applyShelterBrand({
    name: settings.name,
    slug: settings.slug,
    hasLogo: settings.hasLogo,
    primaryColour: settings.primary_colour,
    colourTokens: settings.colourTokens,
  });
  showColourPreview(settings.primary_colour || settings.default_colour, settings.colourTokens);
  showLogo(settings.hasLogo);
}

async function load() {
  await requireAuth();
  const user = await checkAuth();
  const admin = isAdminRole(user);
  [colourInput, colourPicker, colourSave, colourClear, logoInput, logoSave].forEach((el) => {
    if (!el) return;
    if (el.matches('button')) el.hidden = !admin;
    else el.disabled = !admin;
  });

  try {
    const res = await apiRequest('/admin/settings/brand', { method: 'GET' });
    if (!res.ok) {
      setStatus(colourStatus, 'Could not load branding settings.', true);
      return;
    }
    const settings = await res.json();
    if (defaultColourLabel && settings.default_colour) {
      defaultColourLabel.textContent = settings.default_colour;
    }
    const hex = settings.primary_colour || settings.default_colour || '#0f766e';
    if (colourInput) colourInput.value = settings.primary_colour || '';
    syncPickerFromHex(hex);
    applyToPage(settings);
  } catch {
    setStatus(colourStatus, 'Could not load branding settings.', true);
  }
}

colourPicker?.addEventListener('input', () => {
  if (colourInput) colourInput.value = colourPicker.value;
});

colourInput?.addEventListener('input', () => {
  const v = colourInput.value.trim();
  if (HEX_RE.test(v)) syncPickerFromHex(v);
});

colourForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = colourInput.value.trim();
  if (raw && !HEX_RE.test(raw)) {
    setStatus(colourStatus, 'Enter a six-digit hex colour such as #0f766e, or clear the field.', true);
    colourInput.focus();
    return;
  }
  colourSave.disabled = true;
  try {
    const res = await apiRequest('/admin/settings/brand', {
      method: 'PUT',
      body: { primary_colour: raw === '' ? null : raw },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(colourStatus, body.error || 'Could not save the colour.', true);
      return;
    }
    if (colourInput) colourInput.value = body.primary_colour || '';
    syncPickerFromHex(body.primary_colour || body.default_colour || '#0f766e');
    applyToPage(body);
    setStatus(colourStatus, body.message || 'Saved.');
  } catch (error) {
    setStatus(colourStatus, error.message || 'Could not save the colour.', true);
  } finally {
    colourSave.disabled = false;
  }
});

colourClear?.addEventListener('click', async () => {
  if (colourInput) colourInput.value = '';
  colourSave.disabled = true;
  colourClear.disabled = true;
  try {
    const res = await apiRequest('/admin/settings/brand', {
      method: 'PUT',
      body: { primary_colour: null },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(colourStatus, body.error || 'Could not clear the colour.', true);
      return;
    }
    syncPickerFromHex(body.default_colour || '#0f766e');
    applyToPage(body);
    setStatus(colourStatus, body.message || 'Using the default palette.');
  } catch (error) {
    setStatus(colourStatus, error.message || 'Could not clear the colour.', true);
  } finally {
    colourSave.disabled = false;
    colourClear.disabled = false;
  }
});

logoForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = logoInput?.files?.[0];
  if (!file) {
    setStatus(logoStatus, 'Choose a PNG or JPEG file first.', true);
    return;
  }
  logoSave.disabled = true;
  try {
    const form = new FormData();
    form.append('logo', file);
    const res = await fetch(`${API_URL}/admin/settings/brand/logo`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(logoStatus, body.error || 'Could not upload the logo.', true);
      return;
    }
    if (logoInput) logoInput.value = '';
    applyToPage(body);
    setStatus(logoStatus, body.message || 'Logo uploaded.');
  } catch (error) {
    setStatus(logoStatus, error.message || 'Could not upload the logo.', true);
  } finally {
    logoSave.disabled = false;
  }
});

document.getElementById('logoutButton')?.addEventListener('click', (event) => {
  event.preventDefault();
  logout();
});

load();
