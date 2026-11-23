const nodemailer = require('nodemailer');
const { currentShelterName } = require('./shelterBrand');
const { isEmailConfigured } = require('./emailConfig');
const { threadUrl } = require('./pushPayloads');
const { escapeHtml, htmlToPlainText, composeMailParts } = require('./emailParts');

async function brandBits() {
  const name = await currentShelterName();
  const plain = name ? String(name) : '';
  const safe = plain ? escapeHtml(plain) : '';
  return {
    name: safe,
    namePlain: plain,
    signoff: safe ? `ShelterLink, ${safe}` : 'ShelterLink',
    signoffPlain: plain ? `ShelterLink, ${plain}` : 'ShelterLink',
  };
}

const {
  EMAIL_HOST,
  EMAIL_PORT = '587',
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
} = process.env;

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: Number(EMAIL_PORT),
  secure: Number(EMAIL_PORT) === 465,
  auth: EMAIL_USER && EMAIL_PASS ? { user: EMAIL_USER, pass: EMAIL_PASS } : undefined,
});

function headerValue(value) {
  return String(value || '').replace(/[\r\n]/g, ' ').trim();
}

async function sendEmail(to, subject, htmlContent, textContent) {
  const safeTo = headerValue(to);
  if (!safeTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeTo)) {
    throw new Error('Recipient email is invalid');
  }

  const parts = composeMailParts(headerValue(subject), htmlContent, textContent);

  const fromAddress = headerValue(EMAIL_FROM || EMAIL_USER);
  if (!fromAddress || !isEmailConfigured()) {
    throw new Error('Missing EMAIL_HOST and EMAIL_FROM/EMAIL_USER configuration');
  }

  return transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: parts.subject,
    html: parts.html,
    text: parts.text,
  });
}

function withText(subject, html) {
  return composeMailParts(subject, html);
}

async function sendApplicationConfirmation(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'Application Received - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your application for <strong>${safeTitle}</strong> has been received.</p>
    <p>We will review it and update you soon.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

function buildApplicationApproval(opportunityTitle, brand) {
  const safeTitle = escapeHtml(opportunityTitle || 'the selected opportunity');
  return withText(
    'Application Approved - ShelterLink',
    `
    <p>Hello,</p>
    <p>Great news! Your application for <strong>${safeTitle}</strong> has been approved.</p>
    <p>You can now participate and log your volunteer hours after the shift.</p>
    <p>Best regards,<br/>${brand.signoff}</p>
    `
  );
}

async function sendApplicationApproval(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const parts = buildApplicationApproval(opportunityTitle, brand);
  return sendEmail(volunteerEmail, parts.subject, parts.html, parts.text);
}

async function sendApplicationRejection(volunteerEmail, opportunityTitle, reason = null) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'the selected opportunity';
  const reasonHtml = reason
    ? `<p><strong>Reason:</strong> ${reason}</p>`
    : '';
  return sendEmail(
    volunteerEmail,
    'Application Update - ShelterLink',
    `
    <p>Hello,</p>
    <p>Thank you for applying for <strong>${safeTitle}</strong>.</p>
    <p>Unfortunately we are unable to accept your application at this time.</p>
    ${reasonHtml}
    <p>There may be other opportunities available — please log in and browse shifts.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendApplicationCancellation(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'Application Cancelled - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your application for <strong>${safeTitle}</strong> has been cancelled.</p>
    <p>If you did not request this cancellation, please contact us.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendHoursApproval(volunteerEmail, hours, opportunityTitle) {
  const brand = await brandBits();
  const safeHours = Number(hours) || 0;
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'Volunteer Hours Approved - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your submitted hours have been approved.</p>
    <p><strong>Opportunity:</strong> ${safeTitle}<br/>
    <strong>Approved Hours:</strong> ${safeHours}</p>
    <p>Thank you for your contribution,<br/>${brand.signoff}</p>
    `
  );
}

async function sendVolunteerApprovalNotification(volunteerEmail, volunteerName) {
  const brand = await brandBits();
  const safeName = volunteerName || 'there';
  return sendEmail(
    volunteerEmail,
    'Profile Approved - ShelterLink',
    `
    <p>Hi ${safeName},</p>
    <p>Great news! Your volunteer profile has been approved${brand.name ? ` by the ${brand.name} team` : ""}.</p>
    <p>You can now browse and apply for volunteer shifts. Log in to get started!</p>
    <p>Thank you for volunteering,<br/>${brand.signoff}</p>
    `
  );
}

async function sendWaitlistPromotion(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'A Spot Opened Up - ShelterLink',
    `
    <p>Hello,</p>
    <p>Good news! A spot opened up for <strong>${safeTitle}</strong>.</p>
    <p>Your application is now pending review. We will update you once an admin has reviewed it.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

/**
 * Instant booking or waitlist auto-fill confirmed a trusted volunteer (SL-NOW-03).
 */
function buildBookingConfirmed(opportunityTitle, brand, { fromWaitlist = false } = {}) {
  const safeTitle = escapeHtml(opportunityTitle || 'the selected opportunity');
  const lead = fromWaitlist
    ? `A place opened up on <strong>${safeTitle}</strong> and you were next on the waitlist.`
    : `You are booked on <strong>${safeTitle}</strong>.`;
  return withText(
    fromWaitlist ? 'You are booked from the waitlist - ShelterLink' : 'You are booked - ShelterLink',
    `
    <p>Hello,</p>
    <p>${lead}</p>
    <p>Your place is confirmed. If you can no longer make it, cancel from My Applications so the next person can have it.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendBookingConfirmed(volunteerEmail, opportunityTitle, { fromWaitlist = false } = {}) {
  const brand = await brandBits();
  const parts = buildBookingConfirmed(opportunityTitle, brand, { fromWaitlist });
  return sendEmail(volunteerEmail, parts.subject, parts.html, parts.text);
}

function buildShiftReminder(details = {}, brand) {
  const title = escapeHtml(details.title || 'your upcoming shift');
  const date = escapeHtml(details.date || 'TBA');
  const time = details.time ? escapeHtml(details.time) : '';
  const location = escapeHtml(details.location || 'TBA');
  return withText(
    'Shift Reminder - ShelterLink',
    `
    <p>Hello,</p>
    <p>This is a reminder that you have an upcoming volunteer shift:</p>
    <p>
      <strong>${title}</strong><br/>
      <strong>Date:</strong> ${date}${time ? `<br/><strong>Time:</strong> ${time}` : ''}<br/>
      <strong>Location:</strong> ${location}
    </p>
    <p>We look forward to seeing you.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendShiftReminder(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const parts = buildShiftReminder(details, brand);
  return sendEmail(volunteerEmail, parts.subject, parts.html, parts.text);
}

async function sendOpportunityMatchDigest(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const name = details.name || 'there';
  const opportunities = Array.isArray(details.opportunities) ? details.opportunities : [];
  const listHtml = opportunities.length
    ? `<ul>${opportunities
        .map(
          (o) =>
            `<li><strong>${o.title || 'Opportunity'}</strong><br/>${o.when || 'TBA'} · ${
              o.location || 'TBA'
            }</li>`
        )
        .join('')}</ul>`
    : '<p>New opportunities matching your interests are available.</p>';

  return sendEmail(
    volunteerEmail,
    'New opportunities for you - ShelterLink',
    `
    <p>Hi ${name},</p>
    <p>Based on your interests, we found new volunteer opportunities that may suit you:</p>
    ${listHtml}
    <p>Log in to ShelterLink to browse and apply.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendQualificationExpiryNotice(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const name = details.name || 'there';
  const qualificationName = details.qualificationName || 'a qualification';
  const expiresAt = details.expiresAt || 'soon';
  const kind = details.kind === 'expired' ? 'expired' : 'warning';

  if (kind === 'expired') {
    return sendEmail(
      volunteerEmail,
      'Qualification Expired - ShelterLink',
      `
      <p>Hi ${name},</p>
      <p>Your qualification <strong>${qualificationName}</strong> expired on <strong>${expiresAt}</strong>.</p>
      <p>You may no longer be eligible for shifts that require this training. Please contact the shelter to renew it.</p>
      <p>Thank you,<br/>${brand.signoff}</p>
      `
    );
  }

  return sendEmail(
    volunteerEmail,
    'Qualification Expiring Soon - ShelterLink',
    `
    <p>Hi ${name},</p>
    <p>This is a reminder that your qualification <strong>${qualificationName}</strong> expires on <strong>${expiresAt}</strong> (in 30 days).</p>
    <p>Please renew it before then so you can keep applying for shifts that require this training.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendTrainingRefresherNotice(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const name = details.name || 'there';
  const qualificationName = details.qualificationName || 'your training';
  const expiresAt = details.expiresAt || 'soon';
  const warnDays = Number(details.warnDays) || 14;

  return sendEmail(
    volunteerEmail,
    'Training refresher due - ShelterLink',
    `
    <p>Hi ${name},</p>
    <p>Your training for <strong>${qualificationName}</strong> expires on <strong>${expiresAt}</strong> (in ${warnDays} days).</p>
    <p>Retake the module before then so you can keep applying for shifts that require it.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendSwapOpened(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'your shift';
  return sendEmail(
    volunteerEmail,
    'Swap Request Opened - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your swap request for <strong>${safeTitle}</strong> is open.</p>
    <p>We will email you when another volunteer covers the shift.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

/**
 * Seat freed on a full shift: time-limited claim link for the next waitlisted
 * volunteer (SL-LATER-23). Distinct from swap waitlist offers.
 */
function buildWaitlistSeatOffer(details = {}, brand) {
  const title = details.title || 'a shift';
  const claimLink = details.claimLink || '#';
  const hours = details.hours || 12;
  const safeLink = escapeHtml(claimLink).replace(/"/g, '&quot;');
  return withText(
    'A place opened on the waitlist - ShelterLink',
    `
    <p>Hello,</p>
    <p>A place opened on <strong>${escapeHtml(title)}</strong> and you are next on the waitlist.</p>
    <p>You have <strong>${Number(hours) || 12} hours</strong> to claim it before it is offered to the next person:</p>
    <p><a href="${safeLink}">Claim this place</a></p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendWaitlistSeatOffer(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const parts = buildWaitlistSeatOffer(details, brand);
  return sendEmail(volunteerEmail, parts.subject, parts.html, parts.text);
}

async function sendSwapWaitlistOffer(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const title = details.title || 'a shift';
  const claimLink = details.claimLink || '#';
  const hours = details.hours || 12;
  return sendEmail(
    volunteerEmail,
    'Cover Opportunity From Waitlist - ShelterLink',
    `
    <p>Hello,</p>
    <p>A spot on <strong>${title}</strong> is available via a shift swap, and you are first on the waitlist.</p>
    <p>You have <strong>${hours} hours</strong> to claim it before it is offered publicly:</p>
    <p><a href="${claimLink}">Claim this shift</a></p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendSwapClaimedToOriginal(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'your shift';
  return sendEmail(
    volunteerEmail,
    'Your Shift Was Covered - ShelterLink',
    `
    <p>Hello,</p>
    <p>Good news — another volunteer has covered <strong>${safeTitle}</strong>.</p>
    <p>Your application for that shift is now cancelled.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendSwapClaimedToClaimer(volunteerEmail, opportunityTitle) {
  const brand = await brandBits();
  const safeTitle = opportunityTitle || 'the shift';
  return sendEmail(
    volunteerEmail,
    'Shift Cover Confirmed - ShelterLink',
    `
    <p>Hello,</p>
    <p>You have successfully claimed <strong>${safeTitle}</strong>.</p>
    <p>Your application is accepted — see you at the shelter!</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendFeedbackRequest(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const name = details.name || 'there';
  const title = details.title || 'your recent shift';
  const date = details.date || 'recently';
  const feedbackLink = details.feedbackLink || '#';
  return sendEmail(
    volunteerEmail,
    'How was your shift? - ShelterLink',
    `
    <p>Hi ${name},</p>
    <p>Thanks for volunteering at <strong>${title}</strong> on <strong>${date}</strong>.</p>
    <p>We would love a quick rating (no login needed):</p>
    <p><a href="${feedbackLink}">Leave feedback</a></p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendFeedbackConcernAlert(adminEmail, details = {}) {
  const brand = await brandBits();
  const volunteerName = details.volunteerName || 'A volunteer';
  const title = details.title || 'a shift';
  const date = details.date || 'recently';
  const rating = details.rating != null ? details.rating : 'n/a';
  const comment = details.comment
    ? `<p><strong>Comment:</strong> ${details.comment}</p>`
    : '';
  return sendEmail(
    adminEmail,
    'Volunteer flagged a concern - ShelterLink',
    `
    <p>Hello,</p>
    <p><strong>${volunteerName}</strong> flagged that something needs attention after <strong>${title}</strong> (${date}).</p>
    <p><strong>Rating:</strong> ${rating} / 5</p>
    ${comment}
    <p>Review this in the admin feedback page.</p>
    <p>Thank you,<br/>ShelterLink</p>
    `
  );
}

async function sendGroupBookingReceived(contactEmail, details = {}) {
  const brand = await brandBits();
  const groupName = details.groupName || 'your group';
  const title = details.opportunityTitle || 'a volunteer opportunity';
  const size = details.size != null ? details.size : '';
  return sendEmail(
    contactEmail,
    'Group booking received - ShelterLink',
    `
    <p>Hello ${escapeHtml(details.contactName || '')},</p>
    <p>We received your group booking request for <strong>${escapeHtml(groupName)}</strong>
    (${escapeHtml(size)} people) on <strong>${escapeHtml(title)}</strong>.</p>
    <p>An administrator will review your request and email you once it is confirmed or declined.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendGroupBookingConfirmed(contactEmail, details = {}) {
  const brand = await brandBits();
  const groupName = details.groupName || 'your group';
  const title = details.opportunityTitle || 'a volunteer opportunity';
  const when = details.startDate || 'the scheduled date';
  return sendEmail(
    contactEmail,
    'Group booking confirmed - ShelterLink',
    `
    <p>Hello ${escapeHtml(details.contactName || '')},</p>
    <p>Great news! Your group booking for <strong>${escapeHtml(groupName)}</strong> on
    <strong>${escapeHtml(title)}</strong> (${escapeHtml(when)}) has been <strong>confirmed</strong>.</p>
    <p>We look forward to welcoming your group.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendGroupBookingDeclined(contactEmail, details = {}) {
  const brand = await brandBits();
  const groupName = details.groupName || 'your group';
  const title = details.opportunityTitle || 'a volunteer opportunity';
  return sendEmail(
    contactEmail,
    'Group booking update - ShelterLink',
    `
    <p>Hello ${escapeHtml(details.contactName || '')},</p>
    <p>Unfortunately we are unable to confirm the group booking for
    <strong>${escapeHtml(groupName)}</strong> on <strong>${escapeHtml(title)}</strong> at this time.</p>
    <p>Please reply if you would like to discuss alternative dates or sizes.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendUrgentCover(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const title = details.opportunityTitle || 'a volunteer shift';
  const when = details.whenLabel || details.date || '';
  const location = details.location || '';
  const subject = `Cover needed: ${title}${when ? ` ${when}` : ''}`;
  return sendEmail(
    volunteerEmail,
    subject,
    `
    <p>Hello${details.firstName ? ` ${details.firstName}` : ''},</p>
    <p>We urgently need cover for <strong>${title}</strong>${when ? ` on <strong>${when}</strong>` : ''}.</p>
    ${location ? `<p>Location: ${location}</p>` : ''}
    <p>If you can help, please log in to ShelterLink and apply for the shift.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendFosterPlacementConfirmation(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const name = details.volunteerName || 'there';
  const animalName = details.animalName || 'your foster animal';
  const startedOn = details.startedOn || 'soon';
  const expectedEnd = details.expectedEndOn
    ? `<p><strong>Expected end:</strong> ${details.expectedEndOn}</p>`
    : '';
  const handling = details.handlingNotes
    ? `<p><strong>Handling notes:</strong></p><p>${details.handlingNotes}</p>`
    : '<p>Please check ShelterLink for any handling notes for this animal.</p>';
  const emergency = details.emergencyPhone
    ? `<p><strong>Shelter emergency phone:</strong> ${details.emergencyPhone}</p>`
    : '';

  return sendEmail(
    volunteerEmail,
    `Foster placement confirmed: ${animalName} - ShelterLink`,
    `
    <p>Hi ${name},</p>
    <p>Thank you — your foster placement for <strong>${animalName}</strong> is confirmed.</p>
    <p><strong>Start date:</strong> ${startedOn}</p>
    ${expectedEnd}
    ${handling}
    ${emergency}
    <p>Please log check-ins from your Foster page in ShelterLink.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

function buildWeeklyDigest(details = {}, brand) {
  const name = escapeHtml(details.name || 'there');
  const myShifts = Array.isArray(details.myShifts) ? details.myShifts : [];
  const openShifts = Array.isArray(details.openShifts) ? details.openShifts : [];
  const fosterMatches = Array.isArray(details.fosterMatches) ? details.fosterMatches : [];
  const unreadCount = Number(details.unreadCount) || 0;

  const myHtml = myShifts.length
    ? `<ul>${myShifts
        .map(
          (s) =>
            `<li><strong>${escapeHtml(s.title || 'Shift')}</strong><br/>${escapeHtml(s.when || 'TBA')} · ${
              escapeHtml(s.location || 'TBA')
            }</li>`
        )
        .join('')}</ul>`
    : '<p>No accepted shifts scheduled this week.</p>';

  const openHtml = openShifts.length
    ? `<ul>${openShifts
        .map(
          (s) =>
            `<li><strong>${escapeHtml(s.title || 'Opportunity')}</strong><br/>${escapeHtml(s.when || 'TBA')} · ${
              escapeHtml(s.location || 'TBA')
            }</li>`
        )
        .join('')}</ul>`
    : '<p>No open shifts listed for this week.</p>';

  const fosterHtml = fosterMatches.length
    ? `<ul>${fosterMatches
        .map(
          (f) =>
            `<li><strong>${escapeHtml(f.animalName || 'Foster')}</strong> (${escapeHtml(f.urgency || 'planned')}) - needed from ${
              escapeHtml(f.neededFrom || 'TBA')
            }</li>`
        )
        .join('')}</ul>`
    : '';

  const unreadHtml =
    unreadCount > 0
      ? `<p>You have <strong>${unreadCount}</strong> unread message${unreadCount === 1 ? '' : 's'}.</p>`
      : '';

  return withText(
    'Your weekly ShelterLink digest',
    `
    <p>Hi ${name},</p>
    <p>Here is your week ahead${brand.name ? ` at ${brand.name}` : ''}.</p>
    <h3>Your shifts this week</h3>
    ${myHtml}
    <h3>Open shifts you could help with</h3>
    ${openHtml}
    ${fosterHtml ? `<h3>Foster matches</h3>${fosterHtml}` : ''}
    ${unreadHtml}
    <p>Log in to ShelterLink for full details.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendWeeklyDigest(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const parts = buildWeeklyDigest(details, brand);
  return sendEmail(volunteerEmail, parts.subject, parts.html, parts.text);
}

async function sendThreadDigest(toEmail, details = {}) {
  const brand = await brandBits();
  const name = details.name || 'there';
  const unreadCount = Number(details.unreadCount) || 1;
  const role = details.role || 'volunteer';
  const path = threadUrl(details.threadId || details.thread_id || null, role);
  const base = process.env.APP_URL || '';
  const link =
    details.link ||
    (base ? `${base.replace(/\/$/, '')}${path}` : path);
  const muteHint =
    role === 'admin' || role === 'staff'
      ? 'You can mute a thread from Messages if you prefer not to get these reminders.'
      : 'You can mute a thread from the messages page if you prefer not to get these reminders.';
  return sendEmail(
    toEmail,
    'Unread messages in ShelterLink',
    `
    <p>Hi ${name},</p>
    <p>You have <strong>${unreadCount}</strong> unread message${unreadCount === 1 ? '' : 's'} in ShelterLink.</p>
    <p><a href="${link}">Open your messages</a></p>
    <p>${muteHint}</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendShiftNoteUpdate(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const title = details.title || 'your shift';
  const date = details.date || '';
  const body = details.body || '';
  const subjectDate = date ? ` ${date}` : '';
  return sendEmail(
    volunteerEmail,
    `Update for your shift: ${title}${subjectDate}`,
    `
    <p>Hello,</p>
    <p>There is an update for your upcoming shift <strong>${title}</strong>${
      date ? ` on <strong>${date}</strong>` : ''
    }:</p>
    <blockquote style="border-left:3px solid #0f766e;padding-left:0.75rem;margin:1rem 0;">
      ${String(body).replace(/\n/g, '<br/>')}
    </blockquote>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

/**
 * One-time invite to set up an account on a shelter. Sent by the platform
 * owner flow, which runs outside any shelter context, so the shelter name is
 * passed in rather than read from brandBits. The link carries the raw token;
 * it is never logged or stored, only its hash is.
 */
async function sendShelterInvite(to, { shelterName, link, role = 'admin', expiresInDays = 7 } = {}) {
  if (!link) throw new Error('Invite link is required');
  const safeShelter = escapeHtml(shelterName || 'your shelter');
  const safeLink = escapeHtml(link).replace(/"/g, '&quot;');
  const what = role === 'staff' ? 'a staff account' : 'the admin account';
  return sendEmail(
    to,
    `Set up ${headerValue(shelterName || 'your shelter')} on ShelterLink`,
    `
    <p>Hello,</p>
    <p>You have been invited to set up ${what} for <strong>${safeShelter}</strong> on ShelterLink.</p>
    <p>
      <a href="${safeLink}" style="display:inline-block;padding:0.6rem 1.4rem;background:#0f766e;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">
        Set up my account
      </a>
    </p>
    <p>Or copy this link into your browser:<br/><small>${safeLink}</small></p>
    <p>This link works once and expires in <strong>${Number(expiresInDays) || 7} days</strong>.
    If you were not expecting it, you can ignore this email and nothing will be set up.</p>
    <p>Thanks,<br/>The ShelterLink Team</p>
    `
  );
}

/**
 * Set-password email for a volunteer a shelter imported from a spreadsheet
 * (SL-LATER-32). Sent only when staff choose to, never by the import. The
 * link is the normal reset-password page with a longer-lived token.
 */
function buildVolunteerSetPasswordInvite(
  { firstName, link, expiresInDays = 7, shelterNamePlain } = {},
  brand
) {
  if (!link) throw new Error('Invite link is required');
  const safeLink = escapeHtml(link).replace(/"/g, '&quot;');
  const where = brand.name ? ` at <strong>${brand.name}</strong>` : '';
  const subjectName = headerValue(shelterNamePlain || brand.namePlain || '');
  return withText(
    subjectName ? `Set your ShelterLink password for ${subjectName}` : 'Set your ShelterLink password',
    `
    <p>Hi ${escapeHtml(firstName) || 'there'},</p>
    <p>You are on the volunteer list${where}, which now uses ShelterLink for shifts and hours. Choose a password to sign in.</p>
    <p>
      <a href="${safeLink}" style="display:inline-block;padding:0.6rem 1.4rem;background:#0f766e;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">
        Set my password
      </a>
    </p>
    <p>Or copy this link into your browser:<br/><small>${safeLink}</small></p>
    <p>This link expires in <strong>${Number(expiresInDays) || 7} days</strong>. If you do not volunteer here, you can ignore this email.</p>
    <p>Thanks,<br/>${brand.signoff}</p>
    `
  );
}

async function sendVolunteerSetPasswordInvite(to, { firstName, link, expiresInDays = 7 } = {}) {
  const brand = await brandBits();
  const parts = buildVolunteerSetPasswordInvite(
    { firstName, link, expiresInDays, shelterNamePlain: brand.namePlain },
    brand
  );
  return sendEmail(to, parts.subject, parts.html, parts.text);
}

/**
 * Password reset (forgot-password). Shelter name is passed in because the
 * request may run outside the volunteer's shelter ALS context.
 */
function buildPasswordReset({ firstName, link, shelterName } = {}, brand) {
  if (!link) throw new Error('Reset link is required');
  const safeLink = escapeHtml(link).replace(/"/g, '&quot;');
  const plainShelter = shelterName || brand.namePlain || '';
  const safeShelter = plainShelter ? escapeHtml(plainShelter) : '';
  const signoff = brand && brand.signoff
    ? brand.signoff
    : safeShelter
      ? `ShelterLink, ${safeShelter}`
      : 'The ShelterLink Team';
  return withText(
    'Reset Your ShelterLink Password',
    `
    <p>Hi ${escapeHtml(firstName || 'there')},</p>
    <p>We received a request to reset your ShelterLink password${safeShelter ? ` for ${safeShelter}` : ''}.</p>
    <p>
      <a href="${safeLink}" style="display:inline-block;padding:0.6rem 1.4rem;background:#0f766e;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">
        Reset My Password
      </a>
    </p>
    <p>Or copy this link into your browser:<br/><small>${safeLink}</small></p>
    <p>This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>
    <p>Thanks,<br/>${signoff}</p>
    `
  );
}

async function sendPasswordReset(to, details = {}) {
  const brand = details.shelterName
    ? {
        name: escapeHtml(details.shelterName),
        namePlain: String(details.shelterName),
        signoff: `ShelterLink, ${escapeHtml(details.shelterName)}`,
        signoffPlain: `ShelterLink, ${details.shelterName}`,
      }
    : await brandBits();
  const parts = buildPasswordReset(details, brand);
  return sendEmail(to, parts.subject, parts.html, parts.text);
}

/**
 * Short staff-triggered thank-you for anniversary or 50 attended shifts (SL-DAY-06).
 * No scores, no public display wording.
 */
function buildMilestoneThankYou(details = {}, brand) {
  const name = escapeHtml(details.firstName || 'there');
  const shelter = brand.name ? ` at ${brand.name}` : '';
  const kind = String(details.kind || '');
  let reason;
  if (kind === 'shifts_50') {
    reason = 'reaching 50 attended shifts';
  } else {
    reason = 'completing one year of volunteering';
  }
  return withText(
    `Thank you - ShelterLink`,
    `
    <p>Hi ${name},</p>
    <p>Thank you for ${reason}${shelter}. Your time with the animals and the team makes a real difference.</p>
    <p>We are glad you are part of ShelterLink.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendMilestoneThankYou(volunteerEmail, details = {}) {
  const brand = await brandBits();
  const parts = buildMilestoneThankYou(details, brand);
  return sendEmail(volunteerEmail, parts.subject, parts.html, parts.text);
}

/**
 * Staff-triggered notice to a buddy when they are paired with a new volunteer
 * (SL-DAY-08). Email only; never automatic without an explicit staff click.
 */
function buildBuddyAssigned(details = {}, brand) {
  const buddyName = escapeHtml(details.buddyFirstName || 'there');
  const volunteerName = escapeHtml(details.volunteerName || 'a new volunteer');
  const shelter = brand.name ? ` at ${brand.name}` : '';
  return withText(
    `You have been asked to buddy a new volunteer - ShelterLink`,
    `
    <p>Hi ${buddyName},</p>
    <p>Staff have asked you to be a buddy for <strong>${volunteerName}</strong>${shelter}.</p>
    <p>Say hello when you next see them, and help with questions about shifts and settling in. You can see this pairing on your volunteer home page.</p>
    <p>Thank you,<br/>${brand.signoff}</p>
    `
  );
}

async function sendBuddyAssigned(buddyEmail, details = {}) {
  const brand = await brandBits();
  const parts = buildBuddyAssigned(details, brand);
  return sendEmail(buddyEmail, parts.subject, parts.html, parts.text);
}

module.exports = {
  currentShelterName,
  brandBits,
  isEmailConfigured,
  escapeHtml,
  htmlToPlainText,
  composeMailParts,
  withText,
  sendEmail,
  sendApplicationConfirmation,
  buildApplicationApproval,
  sendApplicationApproval,
  sendApplicationRejection,
  sendApplicationCancellation,
  sendHoursApproval,
  sendVolunteerApprovalNotification,
  sendWaitlistPromotion,
  buildWaitlistSeatOffer,
  sendWaitlistSeatOffer,
  buildBookingConfirmed,
  sendBookingConfirmed,
  buildShiftReminder,
  sendShiftReminder,
  sendOpportunityMatchDigest,
  sendQualificationExpiryNotice,
  sendTrainingRefresherNotice,
  sendSwapOpened,
  sendSwapWaitlistOffer,
  sendSwapClaimedToOriginal,
  sendSwapClaimedToClaimer,
  sendFeedbackRequest,
  sendFeedbackConcernAlert,
  sendGroupBookingReceived,
  sendGroupBookingConfirmed,
  sendGroupBookingDeclined,
  sendUrgentCover,
  sendFosterPlacementConfirmation,
  buildWeeklyDigest,
  sendWeeklyDigest,
  sendThreadDigest,
  sendShiftNoteUpdate,
  sendShelterInvite,
  buildVolunteerSetPasswordInvite,
  sendVolunteerSetPasswordInvite,
  buildPasswordReset,
  sendPasswordReset,
  buildMilestoneThankYou,
  sendMilestoneThankYou,
  buildBuddyAssigned,
  sendBuddyAssigned,
};
