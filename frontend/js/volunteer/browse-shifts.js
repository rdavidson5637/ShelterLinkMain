import { apiRequest } from '../config.js';
import { createDateBlock, createRuledRow, createSkeletonRows, createStatusLabel } from '../components/rows.js';
import { requireAuth, logout } from '../auth.js';
import { showOpportunityModal, hideOpportunityModal, setOpportunityModalMessage } from '../components/opportunityModal.js';
import { missingQualifications } from '../utils/missingQualifications.js';
import { formatShiftWhen, upcomingFirst } from '../utils/dateFormat.js';
import { groupShiftsByPeriod } from '../utils/groupShifts.js';

const shiftsContainer = document.getElementById('shifts-container');
const coverShiftsSection = document.getElementById('coverShiftsSection');
const coverShiftsContainer = document.getElementById('cover-shifts-container');
const shiftsStatus = document.getElementById('shiftsStatus');
const emptyState = document.getElementById('emptyState');
const emptyStateClearButton = document.getElementById('emptyStateClearButton');
const searchInput = document.getElementById('filter_search');
const fromInput = document.getElementById('filter_from');
const toInput = document.getElementById('filter_to');
const hoursSelect = document.getElementById('filter_hours');
const tagSelect = document.getElementById('filter_tag');
const clearFiltersWrap = document.getElementById('clearFiltersWrap');
const clearFiltersButton = document.getElementById('clearFiltersButton');
const logoutButton = document.getElementById('logoutButton');

let allOpportunities = [];
let coverSwaps = [];
let myApplications = [];
let myQualifications = [];
let profileApproved = true;
let searchDebounceTimer = null;
const DEBOUNCE_MS = 400;

function asOpportunityList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.opportunities)) return data.opportunities;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getMissingQualifications(opportunity) {
  return missingQualifications(opportunity, myQualifications);
}

function isOpportunityFull(opportunity) {
  if (opportunity.status === 'closed') return true;
  const maxVolunteers = Number(opportunity.max_volunteers ?? opportunity.maxVolunteers);
  const spotsFilled = Number(opportunity.spots_filled ?? opportunity.spotsFilled ?? 0);
  if (!Number.isFinite(maxVolunteers) || maxVolunteers <= 0) return false;
  return spotsFilled >= maxVolunteers;
}


const URL_KEYS = { q: 'q', from: 'from', to: 'to', hours: 'hours', tag: 'tag' };

function getFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get(URL_KEYS.q) || '',
    from: params.get(URL_KEYS.from) || '',
    to: params.get(URL_KEYS.to) || '',
    hours: params.get(URL_KEYS.hours) || '',
    tag: params.get(URL_KEYS.tag) || '',
  };
}

function applyFiltersToUrl(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set(URL_KEYS.q, filters.q);
  if (filters.from) params.set(URL_KEYS.from, filters.from);
  if (filters.to) params.set(URL_KEYS.to, filters.to);
  if (filters.hours) params.set(URL_KEYS.hours, filters.hours);
  if (filters.tag) params.set(URL_KEYS.tag, filters.tag);
  const query = params.toString();
  const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({ filters }, '', newUrl);
}

function getFiltersFromForm() {
  return {
    q: (searchInput?.value || '').trim(),
    from: fromInput?.value || '',
    to: toInput?.value || '',
    hours: hoursSelect?.value || '',
    tag: tagSelect?.value || '',
  };
}

function setFormFromFilters(filters) {
  if (searchInput) searchInput.value = filters.q || '';
  if (fromInput) fromInput.value = filters.from || '';
  if (toInput) toInput.value = filters.to || '';
  if (hoursSelect) hoursSelect.value = filters.hours || '';
  if (tagSelect) tagSelect.value = filters.tag || '';
}

function hasActiveFilters(filters) {
  return !!(filters.q || filters.from || filters.to || filters.hours || filters.tag);
}

function getHoursValue(opportunity) {
  const h = opportunity.hours_per_week ?? opportunity.hoursPerWeek;
  if (h == null || h === '') return null;
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}

function matchesHoursFilter(opportunity, hoursFilter) {
  if (!hoursFilter) return true;
  const h = getHoursValue(opportunity);
  if (h == null) return true;
  if (hoursFilter === 'under5') return h < 5;
  if (hoursFilter === '5to15') return h >= 5 && h < 15;
  if (hoursFilter === '15plus') return h >= 15;
  return true;
}

function matchesTextSearch(opportunity, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const title = (opportunity.title || '').toLowerCase();
  const desc = (opportunity.description || '').toLowerCase();
  const loc = (opportunity.location || '').toLowerCase();
  return title.includes(q) || desc.includes(q) || loc.includes(q);
}

function matchesDateRange(opportunity, from, to) {
  const oppStart = opportunity.start_date || opportunity.start;
  const oppEnd = opportunity.end_date || opportunity.end || oppStart;
  if (!oppStart) return true;
  const startDate = new Date(oppStart);
  const endDate = oppEnd ? new Date(oppEnd) : startDate;

  if (from) {
    const fromDate = new Date(from);
    if (endDate < fromDate) return false;
  }
  if (to) {
    const toDate = new Date(to);
    if (startDate > toDate) return false;
  }
  return true;
}

function matchesTagFilter(opportunity, tagFilter) {
  if (!tagFilter) return true;
  const tags = opportunity.tags || [];
  const key = String(tagFilter).toLowerCase();
  return tags.some(
    (t) => String(t.id) === String(tagFilter) || String(t.name || '').toLowerCase() === key
  );
}

function filterOpportunities(opportunities, filters) {
  return opportunities.filter((opp) => {
    if (!matchesTextSearch(opp, filters.q)) return false;
    if (!matchesDateRange(opp, filters.from, filters.to)) return false;
    if (!matchesHoursFilter(opp, filters.hours)) return false;
    if (!matchesTagFilter(opp, filters.tag)) return false;
    return true;
  });
}

function openOpportunityModal(opportunity) {
  const id = opportunity.id ?? opportunity.opportunity_id;
  const hasApplied = myApplications.some(
    (a) => String(a.opportunity_id ?? a.opportunityId) === String(id)
  );
  const isFull = isOpportunityFull(opportunity);
  const missingQuals = getMissingQualifications(opportunity);

  showOpportunityModal(opportunity, {
    hasApplied,
    isFull,
    profileApproved,
    spotsFilled: opportunity.spots_filled ?? opportunity.spotsFilled,
    spotsTotal: opportunity.max_volunteers ?? opportunity.maxVolunteers,
    missingQualifications: missingQuals,
    onApply: missingQuals.length ? null : handleApplyFromModal,
  });
}

async function handleApplyFromModal(opportunity, id, options = {}) {
  const waitlist = Boolean(options.waitlist);
  const confirmed = window.confirm(
    waitlist ? 'Join the waitlist for this shift?' : 'Apply for this shift?'
  );
  if (!confirmed) return;

  try {
    const res = await apiRequest('/applications', {
      method: 'POST',
      body: { opportunityId: id },
    });

    if (res.status === 201) {
      const body = await res.json().catch(() => ({}));
      myApplications.push({
        opportunity_id: id,
        status: body.status || (waitlist ? 'waitlisted' : 'pending'),
      });
      hideOpportunityModal();
      applyFiltersAndRender();
      showApplyNotice(
        waitlist
          ? 'You are on the waitlist. Staff still need to accept it.'
          : 'Application sent. Staff still need to accept it.'
      );
      return;
    }

    if (res.status === 403) {
      const err = await res.json().catch(() => ({}));
      setOpportunityModalMessage(err?.error || 'You cannot apply for this shift.');
      return;
    }

    if (res.status === 409) {
      myApplications.push({ opportunity_id: id, status: 'pending' });
      hideOpportunityModal();
      applyFiltersAndRender();
      showApplyNotice('You have already applied for this shift.');
      return;
    }

    const err = await res.json().catch(() => ({}));
    setOpportunityModalMessage(err?.error || 'Unable to apply for this shift. Please try again.');
  } catch (error) {
    console.error('[Volunteer] apply error:', error);
    setOpportunityModalMessage('Network error while submitting application.');
  }
}

function showApplyNotice(text) {
  if (!shiftsStatus || !text) return;
  const count = shiftsStatus.textContent;
  shiftsStatus.textContent = count ? `${count} ${text}` : text;
  shiftsStatus.scrollIntoView({ block: 'nearest' });
}

function renderOpportunityCard(opportunity) {
  const missingQuals = getMissingQualifications(opportunity);
  const required = opportunity.required_qualifications || [];
  const start = opportunity.start_date || '';
  const end = opportunity.end_date || '';

  const maxVolunteers = opportunity.max_volunteers ?? opportunity.maxVolunteers;
  const spotsFilled = opportunity.spots_filled ?? opportunity.spotsFilled;
  let capacity = createStatusLabel('Places open', 'neutral');
  if (maxVolunteers) {
    const filled = Number(spotsFilled || 0);
    const total = Number(maxVolunteers);
    capacity = filled >= total
      ? createStatusLabel('Full', 'neutral')
      : createStatusLabel(`${total - filled} of ${total} places left`, 'neutral');
  }

  const details = [`${formatShiftWhen(start, end)}, ${opportunity.location || 'location to be confirmed'}`];
  if (required.length) details.push(`Needs: ${required.map((q) => q.name).join(', ')}`);
  if (opportunity.description) {
    const desc = document.createElement('span');
    desc.className = 'description';
    desc.textContent = opportunity.description;
    details.push(desc);
  }
  const oppTags = opportunity.tags || [];
  if (oppTags.length) {
    const tagsMeta = document.createElement('span');
    tagsMeta.className = 'tag-chips';
    oppTags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip-display';
      chip.textContent = t.name;
      tagsMeta.appendChild(chip);
    });
    details.push(tagsMeta);
  }
  if (missingQuals.length) {
    const reason = document.createElement('span');
    reason.className = 'unqualified-reason';
    reason.textContent = `You need ${missingQuals.map((q) => q.name).join(', ')} first.`;
    details.push(reason);
  }

  const viewDetailsButton = document.createElement('button');
  viewDetailsButton.type = 'button';
  viewDetailsButton.className = missingQuals.length ? 'secondary' : 'button-small';
  viewDetailsButton.textContent = 'View details';
  viewDetailsButton.addEventListener('click', () => openOpportunityModal(opportunity));

  const urgent = Number(opportunity.is_urgent) ? createStatusLabel('Cover needed', 'pending') : null;
  const row = createRuledRow({
    lead: createDateBlock(start),
    title: opportunity.title || 'Volunteer shift',
    details,
    end: [urgent, capacity, viewDetailsButton],
    needsYou: Boolean(urgent) && !missingQuals.length,
  });
  row.classList.add('opportunity-card');
  if (missingQuals.length) row.classList.add('opportunity-card--unqualified');
  return row;
}

function applyFiltersAndRender() {
  const filters = getFiltersFromForm();
  applyFiltersToUrl(filters);

  const filtered = filterOpportunities(allOpportunities, filters);
  const total = allOpportunities.length;
  const showing = filtered.length;

  if (shiftsStatus) {
    shiftsStatus.textContent = `Showing ${showing} of ${total} available shifts`;
  }

  if (clearFiltersWrap) {
    clearFiltersWrap.style.display = hasActiveFilters(filters) ? 'block' : 'none';
  }

  if (shiftsContainer) {
    shiftsContainer.innerHTML = '';
    if (filtered.length > 0) {
      shiftsContainer.style.display = '';
      if (emptyState) emptyState.style.display = 'none';
      groupShiftsByPeriod(filtered).forEach((group) => {
        const section = document.createElement('section');
        section.className = 'ruled-panel shift-group';
        const head = document.createElement('header');
        head.className = 'ruled-panel-head';
        const heading = document.createElement('h2');
        heading.textContent = group.heading;
        const count = document.createElement('span');
        count.className = 'shift-group-count';
        const n = group.shifts.length;
        count.textContent = `${n} shift${n === 1 ? '' : 's'}`;
        head.append(heading, count);
        const list = document.createElement('ul');
        list.className = 'ruled-rows';
        group.shifts.forEach((opp) => {
          list.appendChild(renderOpportunityCard(opp));
        });
        section.append(head, list);
        shiftsContainer.appendChild(section);
      });
    } else {
      shiftsContainer.style.display = 'none';
      if (emptyState) {
        emptyState.style.display = 'block';
        const emptyCopy = emptyState.querySelector('p');
        if (emptyCopy) {
          emptyCopy.textContent =
            total > 0
              ? 'No shifts match your search. Try clearing the filters.'
              : 'No shifts available right now. Check back soon!';
        }
      }
    }
  }
}

function clearAllFilters() {
  setFormFromFilters({ q: '', from: '', to: '', hours: '', tag: '' });
  applyFiltersToUrl({});
  applyFiltersAndRender();
}

function setupDebouncedSearch() {
  if (!searchInput) return;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      applyFiltersAndRender();
    }, DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchDebounceTimer);
      applyFiltersAndRender();
    }
  });
}

function attachEventListeners() {
  [fromInput, toInput, hoursSelect, tagSelect].forEach((el) => {
    el?.addEventListener('change', applyFiltersAndRender);
  });

  setupDebouncedSearch();

  if (clearFiltersButton) {
    clearFiltersButton.addEventListener('click', clearAllFilters);
  }

  if (emptyStateClearButton) {
    emptyStateClearButton.addEventListener('click', clearAllFilters);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
}

async function fetchAllOpportunities() {
  try {
    const res = await apiRequest('/opportunities', { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return asOpportunityList(data);
  } catch (error) {
    console.error('[Volunteer] fetchOpportunities error:', error);
    return [];
  }
}

async function fetchCoverSwaps() {
  try {
    const res = await apiRequest('/applications/swaps/available', { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[Volunteer] fetchCoverSwaps error:', error);
    return [];
  }
}

function renderCoverSwapCard(swap) {
  const article = document.createElement('article');
  article.className = 'opportunity-card';

  const title = document.createElement('h3');
  title.textContent = swap.opportunity_title || 'Cover a shift';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const locationMeta = document.createElement('span');
  locationMeta.textContent = swap.opportunity_location || 'Location to be confirmed';
  const dateMeta = document.createElement('span');
  const start = swap.opportunity_start_date || '';
  const end = swap.opportunity_end_date || '';
  dateMeta.textContent = formatShiftWhen(start, end);
  meta.appendChild(locationMeta);
  meta.appendChild(dateMeta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const claimBtn = document.createElement('button');
  claimBtn.type = 'button';
  claimBtn.textContent = swap.can_claim === false
    ? (swap.claim_block ? 'Cannot cover' : 'Cover (unqualified)')
    : 'Cover this shift';
  claimBtn.disabled = swap.can_claim === false;
  claimBtn.addEventListener('click', async () => {
    if (swap.can_claim === false) return;
    const confirmed = window.confirm('Claim this shift? You will take the accepted place.');
    if (!confirmed) return;
    try {
      const res = await apiRequest(`/applications/swaps/${swap.id}/claim`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.error || 'Unable to claim this shift.');
        return;
      }
      alert(body.message || 'Shift claimed.');
      coverSwaps = await fetchCoverSwaps();
      renderCoverSwaps();
      try {
        const appRes = await apiRequest('/applications/my-applications', { method: 'GET' });
        if (appRes.ok) {
          const data = await appRes.json();
          myApplications = Array.isArray(data) ? data : myApplications;
        }
      } catch {
        // keep existing applications list
      }
      applyFiltersAndRender();
    } catch (error) {
      console.error('[Volunteer] claim swap error:', error);
      alert('Network error while claiming shift.');
    }
  });
  actions.appendChild(claimBtn);

  if (Array.isArray(swap.missing_qualifications) && swap.missing_qualifications.length) {
    const reason = document.createElement('p');
    reason.className = 'unqualified-reason';
    reason.textContent = `You need: ${swap.missing_qualifications.map((q) => q.name).join(', ')}`;
    article.appendChild(title);
    article.appendChild(meta);
    article.appendChild(reason);
  } else {
    article.appendChild(title);
    article.appendChild(meta);
  }
  if (swap.claim_block) {
    const blockNote = document.createElement('p');
    blockNote.textContent = swap.claim_block;
    article.appendChild(blockNote);
  }
  article.appendChild(actions);
  return article;
}

function renderCoverSwaps() {
  if (!coverShiftsSection || !coverShiftsContainer) return;
  coverShiftsContainer.innerHTML = '';
  if (!coverSwaps.length) {
    coverShiftsSection.style.display = 'none';
    return;
  }
  coverShiftsSection.style.display = '';
  coverSwaps.forEach((swap) => {
    coverShiftsContainer.appendChild(renderCoverSwapCard(swap));
  });
}

async function loadTagFilterOptions() {
  if (!tagSelect) return;
  try {
    const res = await apiRequest('/tags', { method: 'GET' });
    if (!res.ok) return;
    const tags = await res.json();
    const current = tagSelect.value;
    tagSelect.innerHTML = '<option value="">Any interest</option>';
    (Array.isArray(tags) ? tags : []).forEach((t) => {
      const opt = document.createElement('option');
      opt.value = String(t.id);
      opt.textContent = t.name;
      tagSelect.appendChild(opt);
    });
    if (current) tagSelect.value = current;
  } catch (error) {
    console.error('[Volunteer] loadTagFilterOptions error:', error);
  }
}

function showBrowseLoadError() {
  if (shiftsStatus) shiftsStatus.textContent = 'Unable to load shifts. Please refresh.';
  if (shiftsContainer) {
    shiftsContainer.innerHTML = '';
    shiftsContainer.style.display = 'none';
  }
  if (emptyState) {
    const emptyCopy = emptyState.querySelector('p');
    if (emptyCopy) emptyCopy.textContent = 'Unable to load shifts right now. Please try again.';
    emptyState.style.display = 'block';
  }
}

function renderOpportunityList() {
  if (allOpportunities.length === 0) {
    if (shiftsStatus) shiftsStatus.textContent = 'Showing 0 of 0 available shifts';
    if (shiftsContainer) {
      shiftsContainer.innerHTML = '';
      shiftsContainer.style.display = 'none';
    }
    if (emptyState) {
      const emptyCopy = emptyState.querySelector('p');
      if (emptyCopy) emptyCopy.textContent = 'No shifts available right now. Check back soon!';
      emptyState.style.display = 'block';
    }
    if (clearFiltersWrap) clearFiltersWrap.style.display = 'none';
    return;
  }
  applyFiltersAndRender();
}

async function init() {
  const user = await requireAuth();
  if (!user) return;

  if (shiftsStatus) shiftsStatus.textContent = 'Loading shifts';
  if (shiftsContainer) {
    const list = document.createElement('ul');
    list.className = 'ruled-rows';
    list.appendChild(createSkeletonRows(4));
    const panel = document.createElement('section');
    panel.className = 'ruled-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.appendChild(list);
    shiftsContainer.replaceChildren(panel);
  }

  attachEventListeners();
  const urlFilters = getFiltersFromUrl();
  setFormFromFilters(urlFilters);

  try {
    const [profileRes, appRes, qualsRes, opportunities] = await Promise.all([
      apiRequest('/volunteer/profile', { method: 'GET' }).catch(() => null),
      apiRequest('/applications/my-applications', { method: 'GET' }).catch(() => null),
      apiRequest('/qualifications/mine', { method: 'GET' }).catch(() => null),
      fetchAllOpportunities(),
    ]);

    if (profileRes?.ok) {
      const profile = await profileRes.json().catch(() => ({}));
      profileApproved = Boolean(profile?.approved);
    } else {
      // Covers both a real error response and the fetch itself throwing
      // (.catch(() => null) above) — either way, don't assume approved.
      profileApproved = false;
    }

    if (appRes?.ok) {
      const data = await appRes.json().catch(() => []);
      myApplications = Array.isArray(data) ? data : [];
    } else {
      myApplications = [];
    }

    if (qualsRes?.ok) {
      const data = await qualsRes.json().catch(() => []);
      myQualifications = Array.isArray(data) ? data : [];
    } else {
      myQualifications = [];
    }

    await loadTagFilterOptions();
    allOpportunities = upcomingFirst(opportunities);
    renderOpportunityList();
  } catch (error) {
    console.error('[Volunteer] browse init error:', error);
    showBrowseLoadError();
  }

  fetchCoverSwaps()
    .then((swaps) => {
      coverSwaps = swaps;
      renderCoverSwaps();
    })
    .catch((error) => {
      console.error('[Volunteer] fetchCoverSwaps error:', error);
    });
}

window.addEventListener('popstate', () => {
  const filters = getFiltersFromUrl();
  setFormFromFilters(filters);
  applyFiltersAndRender();
});

function start() {
  init().catch((err) => {
    console.error('[Volunteer] browse-shifts start error:', err);
    showBrowseLoadError();
  });
}

// A deferred module script can still run after DOMContentLoaded already
// fired (slow module fetch) — listening unconditionally would then wait
// forever for an event that's already happened.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
