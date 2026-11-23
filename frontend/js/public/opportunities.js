import { formatShiftWhen } from '../utils/dateFormat.js';
import { applyShelterBrand, loadBrand } from '../brand.js';
import { currentShelterSlug, shelterLinkFor, withShelterQuery } from '../shelterSlug.js';
import { renderEmptyState, renderErrorState } from '../utils/listState.js';
import {
  closedShiftLabel,
  filterPublicBoard,
  isAcceptingSignups,
} from './publicBoard.js';
import { publicOpportunitiesEmptyCopy } from './opportunitiesEmpty.js';

const listEl = document.getElementById('opportunitiesList');

function setListBusy(busy) {
  if (!listEl) return;
  listEl.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showEmpty(shelterName) {
  const copy = publicOpportunitiesEmptyCopy(shelterName);
  listEl.replaceChildren(
    renderEmptyState({
      title: copy.title,
      body: copy.body,
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
    const [res, brand] = await Promise.all([
      fetch(withShelterQuery('/api/public/opportunities'), { credentials: 'omit' }),
      loadBrand(),
    ]);
    if (brand) applyShelterBrand(brand);
    if (!res.ok) {
      showError('The shift list could not be loaded. Try again in a moment.');
      return;
    }
    const rows = filterPublicBoard(await res.json());
    if (!Array.isArray(rows) || !rows.length) {
      showEmpty(brand && brand.name);
      return;
    }
    listEl.replaceChildren();
    listEl.classList.add('shift-list');
    rows.forEach((opp) => {
      const article = document.createElement('article');
      article.className = 'shift-row';
      const spots =
        opp.spots_remaining == null
          ? 'Open spaces'
          : `${opp.spots_remaining} spot${opp.spots_remaining === 1 ? '' : 's'} left`;

      const h2 = document.createElement('h2');
      h2.textContent = opp.title || 'Volunteer shift';
      if (opp.is_urgent) {
        const badge = document.createElement('span');
        badge.className = 'badge-urgent';
        badge.textContent = 'Urgent cover needed';
        h2.appendChild(document.createTextNode(' '));
        h2.appendChild(badge);
      }
      const meta = document.createElement('p');
      meta.className = 'shift-meta';
      const when = document.createElement('strong');
      when.textContent = formatShiftWhen(opp.date || opp.start_date, opp.end_date);
      meta.append(when, ` · ${opp.location || 'Location TBA'}`);
      const spotsP = document.createElement('p');
      spotsP.className = 'shift-spots';
      spotsP.textContent = spots;
      const actions = document.createElement('div');
      actions.className = 'shift-actions';
      if (opp.description) {
        const desc = document.createElement('p');
        desc.className = 'shift-meta';
        desc.textContent = opp.description;
        article.append(h2, meta, desc, spotsP, actions);
      } else {
        article.append(h2, meta, spotsP, actions);
      }
      if (isAcceptingSignups(opp)) {
        const apply = document.createElement('a');
        apply.href = shelterLinkFor('/register.html', currentShelterSlug());
        apply.setAttribute('role', 'button');
        apply.textContent = 'Sign up to apply';
        const group = document.createElement('a');
        group.href = `/pages/group-booking.html?opportunity_id=${encodeURIComponent(opp.id)}`;
        group.className = 'text-link';
        group.textContent = 'Book as a group';
        actions.append(apply, group);
      } else {
        const closed = document.createElement('button');
        closed.type = 'button';
        closed.disabled = true;
        closed.textContent = closedShiftLabel(opp);
        actions.append(closed);
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
