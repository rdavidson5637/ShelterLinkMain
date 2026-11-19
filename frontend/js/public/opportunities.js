import { formatShiftWhen } from '../utils/dateFormat.js';
import { currentShelterSlug, shelterLinkFor, withShelterQuery } from '../shelterSlug.js';
import { renderEmptyState, renderErrorState } from '../utils/listState.js';
import {
  closedShiftLabel,
  filterPublicBoard,
  isAcceptingSignups,
} from './publicBoard.js';

const listEl = document.getElementById('opportunitiesList');

function setListBusy(busy) {
  if (!listEl) return;
  listEl.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showEmpty() {
  listEl.replaceChildren(
    renderEmptyState({
      title: 'No open shifts right now',
      body: 'Nothing is listed at the moment. Check back soon, or create an account so you are ready when a shift opens.',
      actionHref: shelterLinkFor('/register.html', currentShelterSlug()),
      actionLabel: 'Create an account',
    })
  );
}

function showError(body) {
  listEl.replaceChildren(
    renderErrorState({
      title: 'Could not load open shifts',
      body,
      onRetry: () => {
        load();
      },
    })
  );
}

async function load() {
  if (!listEl) return;
  setListBusy(true);
  listEl.replaceChildren();
  const loading = document.createElement('p');
  loading.textContent = 'Loading open shifts…';
  listEl.appendChild(loading);

  try {
    const res = await fetch(withShelterQuery('/api/public/opportunities'), { credentials: 'omit' });
    if (!res.ok) {
      showError('The shift list could not be loaded. Try again in a moment.');
      return;
    }
    const rows = filterPublicBoard(await res.json());
    if (!Array.isArray(rows) || !rows.length) {
      showEmpty();
      return;
    }
    listEl.replaceChildren();
    rows.forEach((opp) => {
      const article = document.createElement('article');
      const spots =
        opp.spots_remaining == null
          ? 'Unlimited spots'
          : `${opp.spots_remaining} spot${opp.spots_remaining === 1 ? '' : 's'} remaining`;

      const h2 = document.createElement('h2');
      h2.textContent = opp.title || 'Volunteer shift';
      if (opp.is_urgent) {
        const badge = document.createElement('span');
        badge.className = 'badge-urgent';
        badge.textContent = ' Urgent cover needed';
        h2.appendChild(badge);
      }
      const desc = document.createElement('p');
      desc.textContent = opp.description || '';
      const meta = document.createElement('p');
      const when = document.createElement('strong');
      when.textContent = formatShiftWhen(opp.date || opp.start_date, opp.end_date);
      meta.append(when, ` · ${opp.location || 'Location TBA'}`);
      const spotsP = document.createElement('p');
      spotsP.textContent = spots;
      if (isAcceptingSignups(opp)) {
        const apply = document.createElement('a');
        apply.href = shelterLinkFor('/register.html', currentShelterSlug());
        apply.setAttribute('role', 'button');
        apply.textContent = 'Sign up to apply';
        const group = document.createElement('a');
        group.href = `/pages/group-booking.html?opportunity_id=${encodeURIComponent(opp.id)}`;
        group.className = 'secondary';
        group.textContent = 'Book as a group';
        article.append(h2, desc, meta, spotsP, apply, group);
      } else {
        const closed = document.createElement('button');
        closed.type = 'button';
        closed.disabled = true;
        closed.textContent = closedShiftLabel(opp);
        article.append(h2, desc, meta, spotsP, closed);
      }
      listEl.appendChild(article);
    });
  } catch (error) {
    console.error('[Public] load opportunities error:', error);
    showError('Network error while loading opportunities. Check your connection and try again.');
  } finally {
    setListBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', load);
