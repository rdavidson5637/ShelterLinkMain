import { API_URL } from './config.js';
import { showFormErrors, clearFormErrors } from './utils/formErrors.js';

const params = new URLSearchParams(window.location.search);
const token = (params.get('token') || '').trim();

const shiftSummary = document.getElementById('shiftSummary');
const messageEl = document.getElementById('message');
const form = document.getElementById('feedbackForm');
const commentInput = document.getElementById('comment');
const flagInput = document.getElementById('flag_concern');
const submitButton = document.getElementById('submitButton');
const starInputs = Array.from(document.querySelectorAll('#starRating input[type="radio"]'));

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
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString();
}

function selectedRating() {
  const checked = document.querySelector('#starRating input[type="radio"]:checked');
  return checked ? Number(checked.value) : 0;
}

function paintStars() {
  const n = selectedRating();
  starInputs.forEach((input) => {
    const on = Number(input.value) <= n;
    input.parentElement.classList.toggle('is-active', on);
  });
}

starInputs.forEach((input) => {
  input.addEventListener('change', paintStars);
  input.addEventListener('focus', paintStars);
});

async function loadForm() {
  if (!token) {
    if (shiftSummary) shiftSummary.textContent = 'This feedback link is missing a token.';
    setMessage('Ask the shelter to resend your feedback email.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/feedback?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      credentials: 'include',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (shiftSummary) shiftSummary.textContent = 'Unable to open this feedback link.';
      setMessage(body.error || 'Invalid feedback link.', 'error');
      return;
    }

    const when = formatDate(body.opportunity_start_date);
    if (shiftSummary) {
      shiftSummary.textContent = when
        ? `${body.opportunity_title || 'Your shift'} · ${when}`
        : body.opportunity_title || 'Your recent shift';
    }

    if (body.already_submitted) {
      setMessage(
        `Thanks. You already rated this shift ${body.existing?.rating || ''}/5.`.trim(),
        'success'
      );
      return;
    }

    if (form) form.hidden = false;
  } catch (error) {
    console.error('[Feedback] loadForm error:', error);
    if (shiftSummary) shiftSummary.textContent = 'Network error loading feedback form.';
    setMessage('Please try again later.', 'error');
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  const rating = selectedRating();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    showFormErrors(form, [{ field: starInputs[0], message: 'Please choose a star rating from 1 to 5.' }]);
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
  }

  try {
    const res = await fetch(`${API_URL}/feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        rating,
        comment: commentInput?.value?.trim() || '',
        flag_concern: Boolean(flagInput?.checked),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showFormErrors(form, [{ message: body.error || 'Unable to submit feedback.' }]);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.setAttribute('aria-busy', 'false');
      }
      return;
    }

    if (form) form.hidden = true;
    setMessage(body.message || 'Thank you for your feedback.', 'success');
  } catch (error) {
    console.error('[Feedback] submit error:', error);
    showFormErrors(form, [{ message: 'Network error while submitting.' }]);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.setAttribute('aria-busy', 'false');
    }
  }
});

document.addEventListener('DOMContentLoaded', loadForm);
