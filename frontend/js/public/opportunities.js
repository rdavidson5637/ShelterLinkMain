import { formatShiftWhen } from '../utils/dateFormat.js';
import {
  closedShiftLabel,
  filterPublicBoard,
  isAcceptingSignups,
} from './publicBoard.js';
import {
  createDateBlock,
  createEmptyState,
  createRuledRow,
  createStatusLabel,
} from '../components/rows.js';

const listEl = document.getElementById('opportunitiesList');

function spotsText(opp) {
  if (opp.spots_remaining == null) return 'No limit on places';
  const n = Number(opp.spots_remaining);
  return `${n} place${n === 1 ? '' : 's'} left`;
}

function showEmpty(sentence, action) {
  listEl.replaceChildren(createEmptyState(sentence, action));
  listEl.removeAttribute('aria-busy');
}

function opportunityRow(opp) {
  const start = opp.date || opp.start_date;
  const details = [
    `${formatShiftWhen(start, opp.end_date)}, ${opp.location || 'location to be confirmed'}`,
    opp.description || '',
  ];

  const end = [];
  if (opp.is_urgent) end.push(createStatusLabel('Cover needed', 'pending'));

  if (isAcceptingSignups(opp)) {
    end.push(createStatusLabel(spotsText(opp), 'neutral'));
    const apply = document.createElement('a');
    apply.href = '/register.html';
    apply.setAttribute('role', 'button');
    apply.className = 'button-small';
    apply.textContent = 'Sign up to apply';
    const group = document.createElement('a');
    group.href = `/pages/group-booking.html?opportunity_id=${encodeURIComponent(opp.id)}`;
    group.textContent = 'Book as a group';
    end.push(apply, group);
  } else {
    end.push(createStatusLabel(closedShiftLabel(opp), 'neutral'));
  }

  return createRuledRow({
    lead: createDateBlock(start),
    title: opp.title || 'Volunteer shift',
    details,
    end,
    needsYou: Boolean(opp.is_urgent) && isAcceptingSignups(opp),
  });
}

async function load() {
  if (!listEl) return;
  try {
    const res = await fetch('/api/public/opportunities', { credentials: 'omit' });
    if (!res.ok) {
      showEmpty('Open shifts could not be loaded just now. Try again in a minute.');
      return;
    }
    const rows = filterPublicBoard(await res.json());
    if (!Array.isArray(rows) || !rows.length) {
      showEmpty('There are no open shifts at the moment.', {
        href: '/register.html',
        label: 'Create an account so you are ready to apply',
      });
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'ruled-rows';
    rows.forEach((opp) => ul.appendChild(opportunityRow(opp)));
    listEl.replaceChildren(ul);
    listEl.removeAttribute('aria-busy');
  } catch (error) {
    console.error('[Public] load opportunities error:', error);
    showEmpty('Open shifts could not be loaded. Check your connection and try again.');
  }
}

document.addEventListener('DOMContentLoaded', load);
