import { apiRequest } from '/js/config.js';
import { requireAuth } from '/js/auth.js';

const statusEl = document.getElementById('claimStatus');
const claimButton = document.getElementById('claimButton');
const params = new URLSearchParams(window.location.search);
const token = (params.get('token') || '').trim();

async function init() {
  await requireAuth();
  if (!token) {
    statusEl.textContent = 'This claim link is missing a token.';
    return;
  }
  statusEl.textContent = 'You have a waitlist offer to cover a shift. Claim it within 12 hours of the email.';
  claimButton.hidden = false;
  claimButton.addEventListener('click', async () => {
    claimButton.disabled = true;
    try {
      const res = await apiRequest('/applications/swaps/claim-by-token', {
        method: 'POST',
        body: { token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = body?.error || 'Unable to claim this shift.';
        claimButton.disabled = false;
        return;
      }
      statusEl.textContent = body.message || 'Shift claimed successfully.';
      claimButton.hidden = true;
    } catch (error) {
      console.error(error);
      statusEl.textContent = 'Network error while claiming.';
      claimButton.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
