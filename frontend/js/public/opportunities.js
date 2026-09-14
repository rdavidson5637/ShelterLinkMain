import { formatShiftWhen } from '../utils/dateFormat.js';
import {
  closedShiftLabel,
  filterPublicBoard,
  isAcceptingSignups,
} from './publicBoard.js';

const listEl = document.getElementById('opportunitiesList');

async function load() {
  if (!listEl) return;
  try {
    const res = await fetch('/api/public/opportunities', { credentials: 'omit' });
    if (!res.ok) {
      listEl.replaceChildren();
      const p = document.createElement('p');
      p.textContent = 'Unable to load opportunities right now.';
      listEl.appendChild(p);
      return;
    }
    const rows = filterPublicBoard(await res.json());
    if (!Array.isArray(rows) || !rows.length) {
      listEl.replaceChildren();
      const p = document.createElement('p');
      p.textContent = 'No open shifts at the moment. Please check back soon.';
      listEl.appendChild(p);
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
        badge.textContent = ' Urgent cover needed';
        badge.style.cssText = 'color:#7a1f1f;font-weight:600;font-size:0.85em;';
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
        apply.href = '/register.html';
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
    listEl.replaceChildren();
    const p = document.createElement('p');
    p.textContent = 'Network error while loading opportunities.';
    listEl.appendChild(p);
  }
}

document.addEventListener('DOMContentLoaded', load);
