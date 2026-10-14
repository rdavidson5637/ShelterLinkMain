import { API_URL, apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { formatShiftWhen, parseShiftDate } from '../utils/dateFormat.js';
import { renderStatCards } from '../components/statCard.js';
import { showConfirm } from '../components/confirmDialog.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { mountInstallPrompt } from '../components/installPrompt.js';
import { mountPushToggle } from '../components/pushToggle.js';
import { buildCalendarSubscribeUrls } from '../utils/calendarUrls.js';

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
const appleCalLink = document.getElementById('appleCalLink');
const googleCalLink = document.getElementById('googleCalLink');
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
    const items = [
      ['Profile completed', data.profile_complete],
      ['Profile approved', data.profile_approved],
      [`References received (${data.references_received || 0})`, (data.references_received || 0) > 0],
      ['Clear background check', data.has_clear_background_check],
      ['Waivers accepted', data.waivers_complete],
    ];
    el.innerHTML = `<ul>${items.map(([label, ok]) => `<li>${ok ? '\u2713' : '\u25cb'} ${label}</li>`).join('')}</ul>`;
  } catch (error) {
    console.error('[Dashboard] onboarding checklist error:', error);
    el.textContent = 'Unable to load onboarding checklist.';
  }
}
