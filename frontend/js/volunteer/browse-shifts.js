import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { showOpportunityModal, hideOpportunityModal } from '../components/opportunityModal.js';

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

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function isQualificationValid(award, asOf = new Date()) {
  if (!award) return false;
  const expires = toDateOnly(award.expires_at);
  if (!expires) return true;
  return expires >= toDateOnly(asOf);
}

function getMissingQualifications(opportunity) {
  const required = opportunity.required_qualifications || [];
  if (!required.length) return [];
  const heldById = new Map(
    myQualifications.map((q) => [Number(q.qualification_id), q])
  );
  return required.filter((req) => {
    const held = heldById.get(Number(req.id));
    return !isQualificationValid(held);
  });
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
      return;
    }

    if (res.status === 403) {
      hideOpportunityModal();
      shiftsContainer.innerHTML = '<p>Please complete and get your profile approved first.</p>';
      return;
    }

    if (res.status === 409) {
      myApplications.push({ opportunity_id: id, status: 'pending' });
      hideOpportunityModal();
      applyFiltersAndRender();
      return;
    }

    const err = await res.json().catch(() => ({}));
    alert(err?.error || 'Unable to apply for this shift. Please try again.');
  } catch (error) {
    console.error('[Volunteer] apply error:', error);
    alert('Network error while submitting application.');
  }
}

function renderOpportunityCard(opportunity) {
  const article = document.createElement('article');
  article.className = 'opportunity-card';

  const missingQuals = getMissingQualifications(opportunity);
  const required = opportunity.required_qualifications || [];
  if (missingQuals.length) {
    article.classList.add('opportunity-card--unqualified');
  }

  const title = document.createElement('h3');
  title.textContent = opportunity.title || 'Volunteer Opportunity';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const location = opportunity.location || 'Location TBA';
  const start = opportunity.start_date || '';
  const end = opportunity.end_date || '';

  const locationMeta = document.createElement('span');
  locationMeta.textContent = `📍 ${location}`;

  const dateMeta = document.createElement('span');
  dateMeta.textContent = start ? `📅 ${start}${end ? ` - ${end}` : ''}` : '📅 Flexible';

  const maxVolunteers = opportunity.max_volunteers ?? opportunity.maxVolunteers;
  const spotsFilled = opportunity.spots_filled ?? opportunity.spotsFilled;
  const capacityMeta = document.createElement('span');
  if (maxVolunteers) {
    const filled = Number(spotsFilled || 0);
    const total = Number(maxVolunteers);
    capacityMeta.textContent = `👥 ${filled}/${total}${filled >= total ? ' (Full)' : ''}`;
  } else {
    capacityMeta.textContent = '👥 Open';
  }

  meta.appendChild(locationMeta);
  meta.appendChild(dateMeta);
  meta.appendChild(capacityMeta);

  if (required.length) {
    const reqMeta = document.createElement('span');
    reqMeta.className = 'requires-tag';
    reqMeta.textContent = `requires: ${required.map((q) => q.name).join(', ')}`;
    meta.appendChild(reqMeta);
  }

  const oppTags = opportunity.tags || [];
  if (oppTags.length) {
    const tagsMeta = document.createElement('div');
    tagsMeta.innerHTML = oppTags
      .map((t) => `<span class="tag-chip-display">${t.name}</span>`)
      .join('');
    meta.appendChild(tagsMeta);
  }

  if (missingQuals.length) {
    const reason = document.createElement('p');
    reason.className = 'unqualified-reason';
    reason.textContent = `You need: ${missingQuals.map((q) => q.name).join(', ')}`;
    article.appendChild(title);
    article.appendChild(meta);
    article.appendChild(reason);
  } else {
    article.appendChild(title);
    article.appendChild(meta);
  }

  const description = document.createElement('p');
  description.className = 'description';
  const desc = opportunity.description || 'No description provided.';
  description.textContent = desc;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const viewDetailsButton = document.createElement('button');
  viewDetailsButton.type = 'button';
  viewDetailsButton.textContent = missingQuals.length ? 'View (unqualified)' : 'View Details';
  viewDetailsButton.addEventListener('click', () => openOpportunityModal(opportunity));
  actions.appendChild(viewDetailsButton);

  article.appendChild(description);
  article.appendChild(actions);

  return article;
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
      emptyState.style.display = 'none';
      filtered.forEach((opp) => {
        shiftsContainer.appendChild(renderOpportunityCard(opp));
      });
    } else {
      shiftsContainer.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.querySelector('p').textContent =
        total > 0
          ? 'No shifts match your search. Try clearing the filters.'
          : 'No shifts available right now. Check back soon!';
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
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[Volunteer] fetchOpportunities error:', error);
    return [];
  }
}

async function fetchCoverSwaps() {
  try {
    const res = await apiRequest('/applications/swaps/available', { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json();
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
  locationMeta.textContent = `📍 ${swap.opportunity_location || 'Location TBA'}`;
  const dateMeta = document.createElement('span');
  const start = swap.opportunity_start_date || '';
  const end = swap.opportunity_end_date || '';
  dateMeta.textContent = start ? `📅 ${start}${end ? ` - ${end}` : ''}` : '📅 Flexible';
  meta.appendChild(locationMeta);
  meta.appendChild(dateMeta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const claimBtn = document.createElement('button');
  claimBtn.type = 'button';
  claimBtn.textContent = swap.can_claim === false ? 'Cover (unqualified)' : 'Cover this shift';
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
    tagSelect.innerHTML = '<option value="">Any tag</option>';
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

async function init() {
  await requireAuth();

  try {
    const profileRes = await apiRequest('/volunteer/profile', { method: 'GET' });
    if (profileRes?.ok) {
      const profile = await profileRes.json().catch(() => ({}));
      profileApproved = Boolean(profile?.approved);
    }
  } catch {
    profileApproved = false;
  }

  try {
    const appRes = await apiRequest('/applications/my-applications', { method: 'GET' });
    if (appRes?.ok) {
      const data = await appRes.json();
      myApplications = Array.isArray(data) ? data : [];
    }
  } catch {
    myApplications = [];
  }

  try {
    const qualsRes = await apiRequest('/qualifications/mine', { method: 'GET' });
    if (qualsRes?.ok) {
      const data = await qualsRes.json();
      myQualifications = Array.isArray(data) ? data : [];
    }
  } catch {
    myQualifications = [];
  }

  await loadTagFilterOptions();
  attachEventListeners();

  if (shiftsContainer) {
    shiftsContainer.innerHTML = '<p>Loading shifts...</p>';
  }

  allOpportunities = await fetchAllOpportunities();
  coverSwaps = await fetchCoverSwaps();
  renderCoverSwaps();

  const urlFilters = getFiltersFromUrl();
  setFormFromFilters(urlFilters);

  if (allOpportunities.length === 0) {
    if (shiftsStatus) shiftsStatus.textContent = 'Showing 0 of 0 available shifts';
    if (shiftsContainer) {
      shiftsContainer.innerHTML = '';
      shiftsContainer.style.display = 'none';
    }
    emptyState.querySelector('p').textContent = 'No shifts available right now. Check back soon!';
    emptyState.style.display = 'block';
    clearFiltersWrap.style.display = 'none';
  } else {
    applyFiltersAndRender();
  }
}

window.addEventListener('popstate', () => {
  const filters = getFiltersFromUrl();
  setFormFromFilters(filters);
  applyFiltersAndRender();
});

document.addEventListener('DOMContentLoaded', init);
