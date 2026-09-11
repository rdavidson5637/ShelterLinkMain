const nodemailer = require('nodemailer');

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

async function sendEmail(to, subject, htmlContent) {
  if (!to) throw new Error('Recipient email is required');
  if (!subject) throw new Error('Email subject is required');
  if (!htmlContent) throw new Error('Email content is required');

  const fromAddress = EMAIL_FROM || EMAIL_USER;
  if (!fromAddress) {
    throw new Error('Missing EMAIL_FROM/EMAIL_USER configuration');
  }

  return transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html: htmlContent,
  });
}

async function sendApplicationConfirmation(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'Application Received - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your application for <strong>${safeTitle}</strong> has been received.</p>
    <p>We will review it and update you soon.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendApplicationApproval(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'Application Approved - ShelterLink',
    `
    <p>Hello,</p>
    <p>Great news! Your application for <strong>${safeTitle}</strong> has been approved.</p>
    <p>You can now participate and log your volunteer hours after the shift.</p>
    <p>Best regards,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendApplicationRejection(volunteerEmail, opportunityTitle, reason = null) {
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendApplicationCancellation(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'Application Cancelled - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your application for <strong>${safeTitle}</strong> has been cancelled.</p>
    <p>If you did not request this cancellation, please contact us.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendHoursApproval(volunteerEmail, hours, opportunityTitle) {
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
    <p>Thank you for your contribution,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendVolunteerApprovalNotification(volunteerEmail, volunteerName) {
  const safeName = volunteerName || 'there';
  return sendEmail(
    volunteerEmail,
    'Profile Approved - ShelterLink',
    `
    <p>Hi ${safeName},</p>
    <p>Great news! Your volunteer profile has been approved by the Assisi Animal Sanctuary team.</p>
    <p>You can now browse and apply for volunteer shifts. Log in to get started!</p>
    <p>Thank you for volunteering,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendWaitlistPromotion(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'the selected opportunity';
  return sendEmail(
    volunteerEmail,
    'A Spot Opened Up - ShelterLink',
    `
    <p>Hello,</p>
    <p>Good news! A spot opened up for <strong>${safeTitle}</strong>.</p>
    <p>Your application is now pending review. We will update you once an admin has reviewed it.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendShiftReminder(volunteerEmail, details = {}) {
  const title = details.title || 'your upcoming shift';
  const date = details.date || 'TBA';
  const time = details.time || '';
  const location = details.location || 'TBA';
  return sendEmail(
    volunteerEmail,
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendOpportunityMatchDigest(volunteerEmail, details = {}) {
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendQualificationExpiryNotice(volunteerEmail, details = {}) {
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
      <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendSwapOpened(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'your shift';
  return sendEmail(
    volunteerEmail,
    'Swap Request Opened - ShelterLink',
    `
    <p>Hello,</p>
    <p>Your swap request for <strong>${safeTitle}</strong> is open.</p>
    <p>We will email you when another volunteer covers the shift.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendSwapWaitlistOffer(volunteerEmail, details = {}) {
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendSwapClaimedToOriginal(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'your shift';
  return sendEmail(
    volunteerEmail,
    'Your Shift Was Covered - ShelterLink',
    `
    <p>Hello,</p>
    <p>Good news — another volunteer has covered <strong>${safeTitle}</strong>.</p>
    <p>Your application for that shift is now cancelled.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendSwapClaimedToClaimer(volunteerEmail, opportunityTitle) {
  const safeTitle = opportunityTitle || 'the shift';
  return sendEmail(
    volunteerEmail,
    'Shift Cover Confirmed - ShelterLink',
    `
    <p>Hello,</p>
    <p>You have successfully claimed <strong>${safeTitle}</strong>.</p>
    <p>Your application is accepted — see you at the shelter!</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendFeedbackRequest(volunteerEmail, details = {}) {
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendFeedbackConcernAlert(adminEmail, details = {}) {
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
  const groupName = details.groupName || 'your group';
  const title = details.opportunityTitle || 'a volunteer opportunity';
  const size = details.size != null ? details.size : '';
  return sendEmail(
    contactEmail,
    'Group booking received - ShelterLink',
    `
    <p>Hello ${details.contactName || ''},</p>
    <p>We received your group booking request for <strong>${groupName}</strong>
    (${size} people) on <strong>${title}</strong>.</p>
    <p>An administrator will review your request and email you once it is confirmed or declined.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendGroupBookingConfirmed(contactEmail, details = {}) {
  const groupName = details.groupName || 'your group';
  const title = details.opportunityTitle || 'a volunteer opportunity';
  const when = details.startDate || 'the scheduled date';
  return sendEmail(
    contactEmail,
    'Group booking confirmed - ShelterLink',
    `
    <p>Hello ${details.contactName || ''},</p>
    <p>Great news! Your group booking for <strong>${groupName}</strong> on
    <strong>${title}</strong> (${when}) has been <strong>confirmed</strong>.</p>
    <p>We look forward to welcoming your group.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendGroupBookingDeclined(contactEmail, details = {}) {
  const groupName = details.groupName || 'your group';
  const title = details.opportunityTitle || 'a volunteer opportunity';
  return sendEmail(
    contactEmail,
    'Group booking update - ShelterLink',
    `
    <p>Hello ${details.contactName || ''},</p>
    <p>Unfortunately we are unable to confirm the group booking for
    <strong>${groupName}</strong> on <strong>${title}</strong> at this time.</p>
    <p>Please reply if you would like to discuss alternative dates or sizes.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendUrgentCover(volunteerEmail, details = {}) {
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendFosterPlacementConfirmation(volunteerEmail, details = {}) {
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
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendWeeklyDigest(volunteerEmail, details = {}) {
  const name = details.name || 'there';
  const myShifts = Array.isArray(details.myShifts) ? details.myShifts : [];
  const openShifts = Array.isArray(details.openShifts) ? details.openShifts : [];
  const fosterMatches = Array.isArray(details.fosterMatches) ? details.fosterMatches : [];
  const unreadCount = Number(details.unreadCount) || 0;

  const myHtml = myShifts.length
    ? `<ul>${myShifts
        .map(
          (s) =>
            `<li><strong>${s.title || 'Shift'}</strong><br/>${s.when || 'TBA'} · ${
              s.location || 'TBA'
            }</li>`
        )
        .join('')}</ul>`
    : '<p>No accepted shifts scheduled this week.</p>';

  const openHtml = openShifts.length
    ? `<ul>${openShifts
        .map(
          (s) =>
            `<li><strong>${s.title || 'Opportunity'}</strong><br/>${s.when || 'TBA'} · ${
              s.location || 'TBA'
            }</li>`
        )
        .join('')}</ul>`
    : '<p>No open shifts listed for this week.</p>';

  const fosterHtml = fosterMatches.length
    ? `<ul>${fosterMatches
        .map(
          (f) =>
            `<li><strong>${f.animalName || 'Foster'}</strong> (${f.urgency || 'planned'}) — needed from ${
              f.neededFrom || 'TBA'
            }</li>`
        )
        .join('')}</ul>`
    : '';

  const unreadHtml =
    unreadCount > 0
      ? `<p>You have <strong>${unreadCount}</strong> unread message${unreadCount === 1 ? '' : 's'}.</p>`
      : '';

  return sendEmail(
    volunteerEmail,
    'Your weekly ShelterLink digest',
    `
    <p>Hi ${name},</p>
    <p>Here is your week ahead at Assisi Animal Sanctuary.</p>
    <h3>Your shifts this week</h3>
    ${myHtml}
    <h3>Open shifts you could help with</h3>
    ${openHtml}
    ${fosterHtml ? `<h3>Foster matches</h3>${fosterHtml}` : ''}
    ${unreadHtml}
    <p>Log in to ShelterLink for full details.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendThreadDigest(volunteerEmail, details = {}) {
  const name = details.name || 'there';
  const unreadCount = Number(details.unreadCount) || 1;
  const base = process.env.APP_URL || '';
  const link =
    details.link ||
    (base
      ? `${base.replace(/\/$/, '')}/pages/volunteer/messages.html`
      : '/pages/volunteer/messages.html');
  return sendEmail(
    volunteerEmail,
    'Unread messages in ShelterLink',
    `
    <p>Hi ${name},</p>
    <p>You have <strong>${unreadCount}</strong> unread message${unreadCount === 1 ? '' : 's'} in ShelterLink.</p>
    <p><a href="${link}">Open your messages</a></p>
    <p>You can mute a thread from the messages page if you prefer not to get these reminders.</p>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

async function sendShiftNoteUpdate(volunteerEmail, details = {}) {
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
    <blockquote style="border-left:3px solid #1b5e20;padding-left:0.75rem;margin:1rem 0;">
      ${String(body).replace(/\n/g, '<br/>')}
    </blockquote>
    <p>Thank you,<br/>ShelterLink &mdash; Assisi Animal Sanctuary</p>
    `
  );
}

module.exports = {
  sendEmail,
  sendApplicationConfirmation,
  sendApplicationApproval,
  sendApplicationRejection,
  sendApplicationCancellation,
  sendHoursApproval,
  sendVolunteerApprovalNotification,
  sendWaitlistPromotion,
  sendShiftReminder,
  sendOpportunityMatchDigest,
  sendQualificationExpiryNotice,
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
  sendWeeklyDigest,
  sendThreadDigest,
  sendShiftNoteUpdate,
};
