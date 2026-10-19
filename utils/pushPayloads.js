'use strict';

const { formatShelterDate, formatShelterTime } = require('./shelterTime');

function truncate(text, max) {
  const collapsed = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!Number.isFinite(max) || max <= 0) return '';
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max).trimEnd();
}

function sameOriginPath(url) {
  const raw = String(url || '');
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/launch';
}

function threadUrl(threadId, role) {
  const id = threadId == null ? '' : String(threadId);
  if (role === 'admin' || role === 'staff') {
    return id
      ? `/pages/admin/threads.html?thread=${encodeURIComponent(id)}`
      : '/pages/admin/threads.html';
  }
  return id
    ? `/pages/volunteer/messages.html?thread=${encodeURIComponent(id)}`
    : '/pages/volunteer/messages.html';
}

function buildUrgentPayload(source = {}) {
  const title = truncate(source.title || source.opportunityTitle || 'Cover needed', 80) || 'ShelterLink';
  const whenLabel = source.whenLabel || formatShelterDate(source.start_date || source.startDate || '');
  const location = truncate(source.location || '', 80);
  const bodyParts = ['Urgent cover needed'];
  if (whenLabel && whenLabel !== 'TBA') bodyParts.push(whenLabel);
  if (location) bodyParts.push(`at ${location}`);
  const opportunityId = source.opportunityId || source.opportunity_id || source.id;
  return {
    title,
    body: truncate(bodyParts.join(' '), 140),
    url: sameOriginPath(source.url || '/pages/volunteer/browse-shifts.html'),
    type: 'urgent_cover',
    tag: `urgent-${opportunityId || 'cover'}`,
  };
}

function buildReminderPayload(app = {}) {
  const shiftTitle = truncate(app.opportunity_title || app.title || 'your shift', 80);
  const date = formatShelterDate(app.opportunity_start_date || app.start_date || '');
  const time = formatShelterTime(app.opportunity_start_date || app.start_date || '');
  const location = truncate(app.opportunity_location || app.location || '', 80);
  const when = [date, time].filter(Boolean).join(' ');
  const body = truncate(`${when}${location ? ` at ${location}` : ''}`, 140);
  return {
    title: `Shift reminder: ${shiftTitle}`,
    body,
    url: '/pages/volunteer/dashboard.html',
    type: 'reminder',
    tag: `reminder-${app.application_id || app.id || ''}`,
  };
}

function buildThreadPayload(source = {}) {
  const subject = truncate(source.subject || source.threadSubject || 'ShelterLink', 80) || 'ShelterLink';
  const body = truncate(source.body || source.message || '', 80);
  const threadId = source.threadId || source.thread_id || source.id;
  const role = source.role || source.recipientRole || 'volunteer';
  return {
    title: `New message: ${subject}`,
    body,
    url: threadUrl(threadId, role),
    type: 'thread',
    tag: `thread-${threadId || ''}`,
  };
}

function buildFosterPayload(source = {}) {
  const species = truncate(source.species || source.animal_species || 'An animal', 40) || 'An animal';
  const date = formatShelterDate(source.needed_from || source.neededFrom || source.date || '');
  const requestId = source.requestId || source.request_id || source.id;
  return {
    title: 'Foster home needed',
    body: truncate(`${species} needs a foster home from ${date}`, 140),
    url: '/pages/volunteer/foster.html',
    type: 'foster',
    tag: `foster-${requestId || ''}`,
  };
}

module.exports = {
  truncate,
  threadUrl,
  buildUrgentPayload,
  buildReminderPayload,
  buildThreadPayload,
  buildFosterPayload,
};
