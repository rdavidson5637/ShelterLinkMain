import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';
import { applyShelterBrand } from '../brand.js';

const logoutButton = document.getElementById('logoutButton');
const messageEl = document.getElementById('message');
const listEl = document.getElementById('emailTypeList');
const detailEl = document.getElementById('emailDetail');
const shelterNameLabel = document.getElementById('shelterNameLabel');
const detailLabel = document.getElementById('detailLabel');
const detailDescription = document.getElementById('detailDescription');
const detailSubject = document.getElementById('detailSubject');
const detailHtml = document.getElementById('detailHtml');
const detailText = document.getElementById('detailText');

let previews = [];
let selectedId = null;

function setMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.classList.toggle('error', Boolean(isError));
}

function showDetail(item) {
  if (!detailEl || !item) return;
  selectedId = item.id;
  detailEl.hidden = false;
  if (detailLabel) detailLabel.textContent = item.label || '';
  if (detailDescription) detailDescription.textContent = item.description || '';
  if (detailSubject) detailSubject.textContent = item.subject || '';
  if (detailText) detailText.textContent = item.text || '';
  if (detailHtml) {
    detailHtml.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  body { margin: 1rem; font-family: system-ui, sans-serif; color: #1f2937; line-height: 1.5; }
  a { color: #0f766e; }
</style></head><body>${item.html || ''}</body></html>`;
  }
  listEl?.querySelectorAll('[data-email-id]').forEach((btn) => {
    const active = btn.getAttribute('data-email-id') === item.id;
    btn.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

function renderList() {
  if (!listEl) return;
  listEl.replaceChildren();
  for (const item of previews) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-list-item';
    btn.setAttribute('data-email-id', item.id);
    btn.setAttribute('aria-current', item.id === selectedId ? 'true' : 'false');

    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    copy.appendChild(strong);
    copy.appendChild(document.createTextNode(` ${item.description || ''}`));

    const arrow = document.createElement('span');
    arrow.className = 'choice-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';

    btn.appendChild(copy);
    btn.appendChild(arrow);
    btn.addEventListener('click', () => showDetail(item));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

async function loadPreviews() {
  setMessage('Loading previews…');
  const res = await apiRequest(`${API_URL}/admin/email-previews`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not load email previews.', true);
    return;
  }
  const data = await res.json();
  if (data.sends_mail) {
    setMessage('Preview endpoint reported sends_mail; refusing to show.', true);
    return;
  }
  if (shelterNameLabel && data.shelter?.name) {
    shelterNameLabel.textContent = data.shelter.name;
  }
  previews = Array.isArray(data.previews) ? data.previews : [];
  renderList();
  if (previews.length) {
    showDetail(previews[0]);
    setMessage('');
  } else {
    setMessage('No email templates are available to preview.', true);
  }
}

async function init() {
  requireAuth();
  const user = await checkAuth();
  if (!user || !isAdminRole(user)) {
    window.location.href = '/pages/admin/dashboard.html';
    return;
  }
  await applyShelterBrand().catch(() => {});
  logoutButton?.addEventListener('click', () => logout());
  await loadPreviews();
}

init().catch((error) => {
  console.error(error);
  setMessage('Could not load email previews.', true);
});
