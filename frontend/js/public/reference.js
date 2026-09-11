import { API_URL } from '../config.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';

const introEl = document.getElementById('intro');
const form = document.getElementById('referenceForm');
const messageEl = document.getElementById('message');
const declineButton = document.getElementById('declineButton');

function setMessage(text, tone = 'error') {
  if (!messageEl) return;
  messageEl.innerHTML = text ? `<p class="${tone}">${text}</p>` : '';
}

async function loadRequest() {
  if (!token) {
    introEl.textContent = 'This reference link is missing a token.';
    return;
  }
  try {
    const res = await fetch(`${API_URL}/public/references/${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      introEl.textContent = body.error || 'Unable to load this reference request.';
      return;
    }
    introEl.textContent = `Hello ${body.referee_name || ''}. Please complete this confidential reference${
      body.referee_relationship ? ` (${body.referee_relationship})` : ''
    }. It expires on ${String(body.expires_at || '').slice(0, 10)}.`;
    form.hidden = false;
  } catch (error) {
    console.error('[Reference] load error:', error);
    introEl.textContent = 'Network error loading the reference form.';
  }
}

async function submit(payload) {
  setMessage('');
  const res = await fetch(`${API_URL}/public/references/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage(body.error || 'Unable to submit reference', 'error');
    return;
  }
  form.hidden = true;
  setMessage(body.message || 'Thank you.', 'success');
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  await submit({
    is_suitable: data.get('is_suitable') === '1',
    comments: data.get('comments') || '',
    declined: false,
  });
});

declineButton?.addEventListener('click', async () => {
  if (!window.confirm('Decline to provide this reference?')) return;
  await submit({ declined: true });
});

document.addEventListener('DOMContentLoaded', loadRequest);
