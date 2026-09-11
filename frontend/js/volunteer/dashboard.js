import { API_URL, apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { formatShiftWhen, parseShiftDate } from '../utils/dateFormat.js';
import { renderStatCards } from '../components/statCard.js';
import { showConfirm } from '../components/confirmDialog.js';

const userNameEl = document.getElementById('userName');
const profileStatusBannerEl = document.getElementById('profileStatusBanner');
const profileStatusEl = document.getElementById('profileStatus');
const statsGridEl = document.getElementById('statsGrid');
renderStatCards(statsGridEl, [
  { label: 'Total hours', valueId: 'totalHours', value: '0' },
  { label: 'Shifts completed', valueId: 'shiftsCompleted', value: '0' },
  { label: 'Current streak', valueId: 'currentStreak', value: '0' },
]);
const totalHoursEl = document.getElementById('totalHours');
const shiftsCompletedEl = document.getElementById('shiftsCompleted');
const currentStreakEl = document.getElementById('currentStreak');
const badgesListEl = document.getElementById('badgesList');
const nextBadgeProgressEl = document.getElementById('nextBadgeProgress');
const helpedAnimalsDetailsEl = document.getElementById('helpedAnimalsDetails');
const impactCanvas = document.getElementById('impactCanvas');
const downloadImpactButton = document.getElementById('downloadImpactButton');
const nextShiftDetailsEl = document.getElementById('nextShiftDetails');
const recommendedDetailsEl = document.getElementById('recommendedDetails');
const myQualificationsDetailsEl = document.getElementById('myQualificationsDetails');
const myDocumentsDetailsEl = document.getElementById('myDocumentsDetails');
const documentUploadForm = document.getElementById('documentUploadForm');
const documentFileInput = document.getElementById('documentFile');
const documentLabelInput = document.getElementById('documentLabel');
const documentUploadMessage = document.getElementById('documentUploadMessage');
const icalFeedDetailsEl = document.getElementById('icalFeedDetails');
const copyIcalButton = document.getElementById('copyIcalButton');
const logoutButton = document.getElementById('logoutButton');
const exportHoursCsvButton = document.getElementById('exportHoursCsvButton');
let icalUrl = '';
let impactSnapshot = null;
let displayName = 'Volunteer';

function setProfileStatus(content, tone = 'neutral') {
  if (!profileStatusEl) return;
  if (tone === 'success' || tone === 'hidden') {
    if (profileStatusBannerEl) profileStatusBannerEl.hidden = true;
    profileStatusEl.innerHTML = '';
    return;
  }
  if (profileStatusBannerEl) profileStatusBannerEl.hidden = false;
  if (typeof content === 'string') {
    profileStatusEl.innerHTML = content;
  } else {
    profileStatusEl.innerHTML = '';
    profileStatusEl.appendChild(content);
  }
  profileStatusBannerEl.dataset.tone = tone;
}

function setImpactStats(stats = {}) {
  if (totalHoursEl) totalHoursEl.textContent = stats.totalHours ?? 0;
  if (shiftsCompletedEl) shiftsCompletedEl.textContent = stats.shiftsCompleted ?? 0;
  if (currentStreakEl) currentStreakEl.textContent = stats.currentStreak ?? 0;
}

async function loadOnboardingChecklist() {
  const el = document.getElementById('onboardingChecklist');
  if (!el) return;
  try {
    const res = await apiRequest('/vetting/me/onboarding', { method: 'GET' });
    if (!res.ok) {
      el.textContent = 'Unable to load onboarding checklist.';
      return;
    }
    const data = await res.json();
    // Never display referee comments (API already strips them).
    const items = [
      ['Profile completed', data.profile_complete],
      ['Profile approved', data.profile_approved],
      [`References received (${data.references_received || 0})`, (data.references_received || 0) > 0],
      ['Clear background check', data.has_clear_background_check],
      ['Waivers accepted', data.waivers_complete],
    ];
    el.innerHTML = `<ul>${items
      .map(
        ([label, ok]) =>
          `<li>${ok ? '✓' : '○'} ${label}</li>`
      )
      .join('')}</ul>`;
  } catch (error) {
    console.error('[Dashboard] onboarding checklist error:', error);
    el.textContent = 'Unable to load onboarding checklist.';
  }
}

function renderBadges(badges = {}) {
  if (badgesListEl) {
    const earned = badges.earned || [];
    if (!earned.length) {
      badgesListEl.innerHTML = '<p>No badges earned yet — your first shift unlocks First Step.</p>';
    } else {
      badgesListEl.innerHTML = earned
        .map((b) => `<span style="display:inline-block;margin:0.25rem 0.35rem 0.25rem 0;padding:0.35rem 0.6rem;background:#e8f5e9;border-radius:4px;">${b.emoji || ''} ${b.label}</span>`)
        .join('');
    }
  }
  if (nextBadgeProgressEl) {
    const next = badges.nextBadgeProgress;
    if (!next) {
      nextBadgeProgressEl.textContent = 'You have earned every badge. Amazing!';
    } else {
      nextBadgeProgressEl.textContent = `Next: ${next.label} — ${next.current} / ${next.target} (${next.percent}%)`;
    }
  }
}

async function fetchAndDisplayHelpedAnimals() {
  if (!helpedAnimalsDetailsEl) return;
  try {
    const res = await apiRequest('/animals/me/helped');
    if (!res.ok) {
      helpedAnimalsDetailsEl.textContent = 'Unable to load animals right now.';
      return;
    }
    const rows = await res.json();
    if (!rows.length) {
      helpedAnimalsDetailsEl.innerHTML =
        '<p>No animal activity yet. After an accepted shift, log a walk, feed, or socialise from My applications.</p>';
      return;
    }
    helpedAnimalsDetailsEl.innerHTML = `<ul>${rows
      .map(
        (r) =>
          `<li><strong>${r.name}</strong> (${r.species}) — ${r.activity_count} log${
            Number(r.activity_count) === 1 ? '' : 's'
          }</li>`
      )
      .join('')}</ul>`;
  } catch {
    helpedAnimalsDetailsEl.textContent = 'Unable to load animals right now.';
  }
}

function drawImpactCard(stats) {
  if (!impactCanvas) return;
  const ctx = impactCanvas.getContext('2d');
  const w = impactCanvas.width;
  const h = impactCanvas.height;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#1b5e20');
  grad.addColorStop(1, '#43a047');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(w - 80, 80, 140, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px Georgia, serif';
  ctx.fillText('ShelterLink', 48, 70);
  ctx.font = '22px Georgia, serif';
  ctx.fillText('My volunteer impact', 48, 110);

  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText(displayName, 48, 170);

  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText(`${stats.totalHours ?? 0} hours`, 48, 240);
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(`${stats.shiftsCompleted ?? 0} shifts · ${stats.currentStreak ?? 0}-month streak`, 48, 285);

  const earned = stats.badges?.earned || [];
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(
    earned.length ? `Badges: ${earned.map((b) => b.label).join(', ')}` : 'Keep going — badges await!',
    48,
    340
  );

  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('Assisi Animal Sanctuary', 48, 390);
}

function renderCommunityServiceProgress(profile, approvedHours) {
  const card = document.getElementById('communityServiceCard');
  const details = document.getElementById('communityServiceDetails');
  const bar = document.getElementById('communityServiceProgress');
  if (!card || !details) return;

  if (profile?.volunteer_type !== 'community_service' || profile.required_hours == null) {
    card.hidden = true;
    return;
  }

  const target = Number(profile.required_hours) || 0;
  const approved = Number(approvedHours) || 0;
  const remaining = Math.max(target - approved, 0);
  const percent = target > 0 ? Math.min(100, Math.round((approved / target) * 100)) : 0;
  const completed = target > 0 && approved >= target;

  card.hidden = false;
  details.textContent = completed
    ? `Complete — ${approved} / ${target} approved hours.`
    : `${approved} / ${target} approved hours (${remaining} remaining).`;
  if (bar) bar.value = percent;
}

async function fetchAndDisplayStats() {
  try {
    const res = await apiRequest('/stats/me', { method: 'GET' });
    if (!res.ok) {
      setImpactStats();
      return null;
    }
    const stats = await res.json();
    impactSnapshot = stats;
    setImpactStats(stats);
    renderBadges(stats.badges || {});
    drawImpactCard(stats);
    return stats;
  } catch (error) {
    console.error('[Dashboard] fetchAndDisplayStats error:', error);
    setImpactStats();
    return null;
  }
}

async function fetchCurrentUser() {
  try {
    const res = await apiRequest('/auth/me', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load current user');
    return res.json();
  } catch (error) {
    console.error('[Dashboard] fetchCurrentUser error:', error);
    return null;
  }
}

async function fetchProfile() {
  try {
    const res = await apiRequest('/volunteer/profile', { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load profile');
    return res.json();
  } catch (error) {
    console.error('[Dashboard] fetchProfile error:', error);
    setProfileStatus('Unable to load profile status. Please try again later.', 'error');
    return undefined;
  }
}

function renderProfileIncomplete() {
  const link = document.createElement('a');
  link.href = '/pages/volunteer/complete-profile.html';
  link.textContent = 'Complete your profile';
  const fragment = document.createDocumentFragment();
  fragment.append('Your profile is incomplete. ');
  fragment.append(link);
  fragment.append(' to start volunteering.');
  setProfileStatus(fragment, 'warning');
}

function renderProfilePending() {
  setProfileStatus('Profile submitted. Waiting for approval from an administrator.', 'info');
}

function renderProfileApproved() {
  setProfileStatus('', 'success');
}

function isSameCalendarDay(date, now = new Date()) {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isWithinCutoff(appRow, now = new Date()) {
  const start = parseShiftDate(appRow.opportunity_start_date);
  if (!start) return false;
  const cutoff = Number(appRow.cancellation_cutoff_hours ?? 24);
  const safeCutoff = Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : 24;
  return start.getTime() - now.getTime() <= safeCutoff * 60 * 60 * 1000;
}

function renderNextShiftEmpty() {
  if (!nextShiftDetailsEl) return;
  nextShiftDetailsEl.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = 'You have no upcoming shifts.';
  const browse = document.createElement('a');
  browse.href = '/pages/volunteer/browse-shifts.html';
  browse.setAttribute('role', 'button');
  browse.className = 'secondary';
  browse.textContent = 'Browse open shifts';
  nextShiftDetailsEl.append(p, browse);
}

function renderNextShiftActions(next) {
  const actions = document.createElement('p');
  actions.className = 'next-shift-actions';

  const view = document.createElement('a');
  view.href = '/pages/volunteer/browse-shifts.html';
  view.textContent = 'View shift';
  actions.appendChild(view);

  const withinCutoff = isWithinCutoff(next);
  if (!withinCutoff) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary button-secondary button-small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      showConfirm({
        heading: 'Cancel this shift?',
        body: 'You can apply again later if the shift is still open.',
        confirmText: 'Yes, cancel',
        cancelText: 'Keep shift',
        onConfirm: async () => {
          const res = await apiRequest(`/applications/${next.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error || 'Failed to cancel');
          }
          await fetchAndDisplayNextShift();
        },
      });
    });
    actions.appendChild(cancel);
  } else if (!next.open_swap_id) {
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'secondary button-secondary button-small';
    swap.textContent = 'Request a swap';
    swap.addEventListener('click', () => {
      showConfirm({
        heading: 'Request a shift swap?',
        body: 'Other volunteers will be offered the chance to cover this shift. Inside the cancellation window you cannot cancel directly.',
        confirmText: 'Request swap',
        cancelText: 'Keep shift',
        onConfirm: async () => {
          const res = await apiRequest(`/applications/${next.id}/swap`, { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(body?.error || 'Failed to open swap');
          }
          await fetchAndDisplayNextShift();
        },
      });
    });
    actions.appendChild(swap);
  } else {
    const note = document.createElement('span');
    note.textContent = 'Swap request open.';
    actions.appendChild(note);
  }

  return actions;
}

async function fetchAndDisplayNextShift() {
  if (!nextShiftDetailsEl) return;
  try {
    const res = await apiRequest('/applications/my-applications', { method: 'GET' });
    if (!res.ok) {
      nextShiftDetailsEl.textContent = 'Unable to load your next shift.';
      return;
    }
    const apps = await res.json();
    const now = Date.now();
    const upcoming = (Array.isArray(apps) ? apps : [])
      .filter((app) => {
        const status = (app.status || '').toLowerCase();
        if (status !== 'accepted' && status !== 'approved') return false;
        const start = parseShiftDate(app.opportunity_start_date || app.opportunity_end_date);
        return start && start.getTime() >= now - 60 * 60 * 1000;
      })
      .sort((a, b) => {
        const aDate = parseShiftDate(a.opportunity_start_date);
        const bDate = parseShiftDate(b.opportunity_start_date);
        return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
      });

    if (!upcoming.length) {
      renderNextShiftEmpty();
      return;
    }

    const next = upcoming[0];
    const start = parseShiftDate(next.opportunity_start_date);
    nextShiftDetailsEl.innerHTML = '';

    const title = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = next.opportunity_title || 'Volunteer shift';
    title.appendChild(strong);

    const when = document.createElement('p');
    when.textContent = formatShiftWhen(next.opportunity_start_date, next.opportunity_end_date);

    const location = document.createElement('p');
    location.textContent = next.opportunity_location || 'Location TBA';

    nextShiftDetailsEl.append(title, when, location);

    if (start && isSameCalendarDay(start) && next.check_in_code) {
      const code = document.createElement('p');
      code.className = 'next-shift-code';
      code.innerHTML = `Check-in code: <code>${next.check_in_code}</code>`;
      nextShiftDetailsEl.appendChild(code);
    }

    nextShiftDetailsEl.appendChild(renderNextShiftActions(next));
  } catch (error) {
    console.error('[Dashboard] fetchAndDisplayNextShift error:', error);
    nextShiftDetailsEl.textContent = 'Unable to load your next shift.';
  }
}

async function fetchAndDisplayRecommended() {
  if (!recommendedDetailsEl) return;
  try {
    const res = await apiRequest('/tags/recommended', { method: 'GET' });
    if (!res.ok) {
      recommendedDetailsEl.textContent = 'Unable to load recommendations.';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      recommendedDetailsEl.innerHTML =
        'No recommendations yet. <a href="/pages/volunteer/complete-profile.html">Add interest tags</a> or browse open shifts.';
      return;
    }

    const list = document.createElement('div');
    list.className = 'recommended-list';
    rows.forEach((opp) => {
      const item = document.createElement('div');
      item.className = 'recommended-item';
      const tags = (opp.tags || [])
        .map((t) => `<span class="tag-chip-display">${t.name}</span>`)
        .join('');
      const start = opp.start_date ? new Date(opp.start_date).toLocaleString() : 'Flexible';
      item.innerHTML = `
        <a href="/pages/volunteer/browse-shifts.html">${opp.title || 'Opportunity'}</a><br/>
        <small>${start} · ${opp.location || 'Location TBA'}</small>
        ${tags ? `<div>${tags}</div>` : ''}
      `;
      list.appendChild(item);
    });
    recommendedDetailsEl.innerHTML = '';
    recommendedDetailsEl.appendChild(list);
  } catch (error) {
    console.error('[Dashboard] recommended error:', error);
    recommendedDetailsEl.textContent = 'Unable to load recommendations.';
  }
}

function statusLabel(status) {
  if (status === 'expired') return 'Expired';
  if (status === 'expires_today') return 'Expires today';
  if (status === 'expiring_soon') return 'Expiring soon';
  if (status === 'never_expires') return 'Never expires';
  return 'Valid';
}

async function fetchAndDisplayQualifications() {
  if (!myQualificationsDetailsEl) return;
  try {
    const res = await apiRequest('/qualifications/mine', { method: 'GET' });
    if (!res.ok) {
      myQualificationsDetailsEl.textContent = 'Unable to load qualifications.';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      myQualificationsDetailsEl.textContent = 'No qualifications awarded yet.';
      return;
    }
    myQualificationsDetailsEl.innerHTML = `<ul style="margin:0;padding-left:1.1rem;">${rows
      .map((q) => {
        const expires = q.expires_at
          ? `expires ${String(q.expires_at).slice(0, 10)}`
          : 'never expires';
        return `<li><strong>${q.name}</strong> — ${expires} (${statusLabel(q.status)})</li>`;
      })
      .join('')}</ul>`;
  } catch (error) {
    console.error('[Dashboard] qualifications error:', error);
    myQualificationsDetailsEl.textContent = 'Unable to load qualifications.';
  }
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchAndDisplayDocuments() {
  if (!myDocumentsDetailsEl) return;
  try {
    const res = await apiRequest('/documents/mine', { method: 'GET' });
    if (!res.ok) {
      myDocumentsDetailsEl.textContent = 'Unable to load documents.';
      return;
    }
    const docs = await res.json();
    if (!Array.isArray(docs) || !docs.length) {
      myDocumentsDetailsEl.textContent = 'No documents uploaded yet.';
      return;
    }
    myDocumentsDetailsEl.innerHTML = `<ul style="margin:0;padding-left:1.1rem;">${docs
      .map((d) => {
        const label = d.label || d.original_name || 'Document';
        const expires = d.expires_at ? ` · expires ${String(d.expires_at).slice(0, 10)}` : '';
        return `<li>
          <a href="/api/documents/${d.id}/download">${label}</a>
          (${formatBytes(d.size)}${expires})
        </li>`;
      })
      .join('')}</ul>`;
  } catch (error) {
    console.error('[Dashboard] documents error:', error);
    myDocumentsDetailsEl.textContent = 'Unable to load documents.';
  }
}

function setDocUploadMessage(text, tone = 'neutral') {
  if (!documentUploadMessage) return;
  if (!text) {
    documentUploadMessage.textContent = '';
    return;
  }
  documentUploadMessage.className = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  documentUploadMessage.textContent = text;
}

async function handleDocumentUpload(event) {
  event.preventDefault();
  setDocUploadMessage();
  const file = documentFileInput?.files?.[0];
  if (!file) {
    setDocUploadMessage('Please choose a file', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setDocUploadMessage('File too large. Maximum size is 5MB.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  const label = (documentLabelInput?.value || '').trim();
  if (label) formData.append('label', label);

  try {
    const res = await fetch(`${API_URL}/documents`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDocUploadMessage(data?.error || 'Upload failed', 'error');
      return;
    }
    setDocUploadMessage('Document uploaded', 'success');
    documentUploadForm?.reset();
    await fetchAndDisplayDocuments();
  } catch (error) {
    console.error('[Dashboard] document upload error:', error);
    setDocUploadMessage('Network error while uploading', 'error');
  }
}

async function fetchAndDisplayIcalFeed() {
  if (!icalFeedDetailsEl) return;
  try {
    const res = await apiRequest('/me/ical-feed', { method: 'GET' });
    if (!res.ok) {
      icalFeedDetailsEl.textContent = 'Unable to load calendar feed.';
      return;
    }
    const data = await res.json();
    icalUrl = data.url || '';
    icalFeedDetailsEl.textContent = icalUrl
      ? 'Subscribe in your calendar app using the button below.'
      : 'Feed unavailable.';
  } catch (error) {
    console.error('[Dashboard] ical feed error:', error);
    icalFeedDetailsEl.textContent = 'Unable to load calendar feed.';
  }
}

function setExportButtonLoading(loading) {
  if (!exportHoursCsvButton) return;
  exportHoursCsvButton.disabled = loading;
  exportHoursCsvButton.setAttribute('aria-busy', loading ? 'true' : 'false');
  exportHoursCsvButton.textContent = loading ? 'Exporting...' : 'Export My Hours CSV';
}

function getFilenameFromDisposition(contentDisposition) {
  const match = /filename="?([^"]+)"?/i.exec(contentDisposition || '');
  return match?.[1] || `my-hours-${new Date().toISOString().slice(0, 10)}.csv`;
}

async function exportMyHoursCSV() {
  setExportButtonLoading(true);
  try {
    const response = await fetch(`${API_URL}/export/my-hours`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Export failed (${response.status})`);
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const filename = getFilenameFromDisposition(response.headers.get('Content-Disposition'));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('[Dashboard] exportMyHoursCSV error:', error);
    alert('Unable to export CSV right now. Please try again.');
  } finally {
    setExportButtonLoading(false);
  }
}

async function init() {
  await requireAuth();

  const user = await fetchCurrentUser();
  if (user && userNameEl) {
    displayName = user.first_name || user.name || 'Volunteer';
    userNameEl.textContent = displayName;
  }

  await loadOnboardingChecklist();

  const profile = await fetchProfile();
  if (profile === null) {
    renderProfileIncomplete();
    setImpactStats();
    renderNextShiftEmpty();
  } else if (profile && profile.approved) {
    renderProfileApproved();
    const stats = await fetchAndDisplayStats();
    renderCommunityServiceProgress(profile, stats?.totalHours);
    await fetchAndDisplayNextShift();
    await fetchAndDisplayRecommended();
    await fetchAndDisplayQualifications();
    await fetchAndDisplayDocuments();
    await fetchAndDisplayIcalFeed();
    await fetchAndDisplayHelpedAnimals();
  } else if (profile) {
    renderProfilePending();
    setImpactStats();
    if (nextShiftDetailsEl) renderNextShiftEmpty();
    if (recommendedDetailsEl) {
      recommendedDetailsEl.textContent = 'Recommendations appear once your profile is approved.';
    }
    if (myQualificationsDetailsEl) {
      await fetchAndDisplayQualifications();
    }
    await fetchAndDisplayDocuments();
  }

  documentUploadForm?.addEventListener('submit', handleDocumentUpload);

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  if (exportHoursCsvButton) {
    exportHoursCsvButton.addEventListener('click', (event) => {
      event.preventDefault();
      exportMyHoursCSV();
    });
  }

  if (downloadImpactButton) {
    downloadImpactButton.addEventListener('click', () => {
      if (!impactCanvas) return;
      if (impactSnapshot) drawImpactCard(impactSnapshot);
      const link = document.createElement('a');
      link.download = `shelterlink-impact-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = impactCanvas.toDataURL('image/png');
      link.click();
    });
  }

  if (copyIcalButton) {
    copyIcalButton.addEventListener('click', async () => {
      if (!icalUrl) return;
      try {
        await navigator.clipboard.writeText(icalUrl);
        copyIcalButton.textContent = 'Copied!';
        setTimeout(() => { copyIcalButton.textContent = 'Copy subscribe URL'; }, 1500);
      } catch {
        window.prompt('Copy this calendar URL:', icalUrl);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);