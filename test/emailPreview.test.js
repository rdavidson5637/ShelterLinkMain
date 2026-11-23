'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');
const {
  htmlToPlainText,
  composeMailParts,
  escapeHtml,
  buildBookingConfirmed,
  buildApplicationApproval,
  buildShiftReminder,
  buildWaitlistSeatOffer,
  buildVolunteerSetPasswordInvite,
  buildWeeklyDigest,
  buildPasswordReset,
  buildMilestoneThankYou,
  buildBuddyAssigned,
  buildExpiryReminder,
  buildNoShowFollowUp,
  buildUsualAvailabilityAsk,
  buildShelterAnnouncement,
} = require('../utils/emailService');
const { catalogIds, renderEmailPreviews, sampleData } = require('../utils/emailPreview');
const { listEmailPreviews } = require('../controllers/emailPreviewController');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'frontend/pages/admin/email-previews.html'), 'utf8');
const EMAIL_SERVICE = fs.readFileSync(path.join(ROOT, 'utils/emailService.js'), 'utf8');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function brandFor(name) {
  const plain = name || '';
  const safe = plain ? escapeHtml(plain) : '';
  return {
    name: safe,
    namePlain: plain,
    signoff: safe ? `ShelterLink, ${safe}` : 'ShelterLink',
    signoffPlain: plain ? `ShelterLink, ${plain}` : 'ShelterLink',
  };
}

const BUILDERS = [
  {
    id: 'booking',
    build: (brand, samples) => buildBookingConfirmed(samples.opportunityTitle, brand),
  },
  {
    id: 'approval',
    build: (brand, samples) => buildApplicationApproval(samples.opportunityTitle, brand),
  },
  {
    id: 'reminder',
    build: (brand, samples) => buildShiftReminder(samples.reminder, brand),
  },
  {
    id: 'waitlist_offer',
    build: (brand, samples) => buildWaitlistSeatOffer(samples.waitlist, brand),
  },
  {
    id: 'invite',
    build: (brand, samples) => buildVolunteerSetPasswordInvite(samples.invite, brand),
  },
  {
    id: 'digest',
    build: (brand, samples) => buildWeeklyDigest(samples.digest, brand),
  },
  {
    id: 'reset',
    build: (brand, samples) => buildPasswordReset(samples.reset, brand),
  },
  {
    id: 'milestone',
    build: (brand, samples) => buildMilestoneThankYou(samples.milestone, brand),
  },
  {
    id: 'buddy',
    build: (brand, samples) => buildBuddyAssigned(samples.buddy, brand),
  },
  {
    id: 'expiry_reminder',
    build: (brand, samples) => buildExpiryReminder(samples.expiryReminder, brand),
  },
  {
    id: 'noshow_followup',
    build: (brand, samples) => buildNoShowFollowUp(samples.noShow, brand),
  },
  {
    id: 'usual_availability_ask',
    build: (brand, samples) => buildUsualAvailabilityAsk(samples.usualAvailability, brand),
  },
  {
    id: 'shelter_announcement',
    build: (brand, samples) => buildShelterAnnouncement(samples.shelterAnnouncement, brand),
  },
];

test('htmlToPlainText keeps links and list structure', () => {
  const plain = htmlToPlainText(
    '<p>Hello</p><ul><li><strong>Walk</strong></li></ul><p><a href="https://example.com/x">Claim</a></p>'
  );
  assert.match(plain, /Hello/);
  assert.match(plain, /• Walk/);
  assert.match(plain, /Claim \(https:\/\/example\.com\/x\)/);
});

test('composeMailParts always yields html and text', () => {
  const parts = composeMailParts('Subject', '<p>Hi <strong>Alex</strong></p>');
  assert.equal(parts.subject, 'Subject');
  assert.match(parts.html, /Alex/);
  assert.match(parts.text, /Hi Alex/);
  assert.ok(!/</.test(parts.text));
});

test('sendEmail path includes text in nodemailer options', () => {
  assert.match(EMAIL_SERVICE, /text:\s*parts\.text/);
  assert.match(EMAIL_SERVICE, /composeMailParts/);
});

test('each catalog template produces subject, html, and branded plain text', () => {
  const shelter = 'Assisi Animal Sanctuary';
  const brand = brandFor(shelter);
  const samples = sampleData(shelter);
  assert.deepEqual(
    BUILDERS.map((b) => b.id).sort(),
    catalogIds().slice().sort()
  );

  for (const entry of BUILDERS) {
    const parts = entry.build(brand, samples);
    assert.ok(parts.subject, `${entry.id} subject`);
    assert.ok(parts.html && parts.html.includes('<'), `${entry.id} html`);
    assert.ok(parts.text && parts.text.trim(), `${entry.id} text`);
    assert.ok(!/</.test(parts.text) || parts.text.includes('http'), `${entry.id} text not raw html`);
    assert.match(parts.html, new RegExp(escapeHtml(shelter)));
    assert.match(parts.text, new RegExp(shelter));
    assert.match(parts.text, /ShelterLink/);
  }
});

test('renderEmailPreviews is tenant-scoped by shelter name', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/SELECT name FROM shelters WHERE id = \?/i.test(sql)) {
      const id = Number(params[0]);
      if (id === 11) return [[{ name: 'North Shelter' }]];
      if (id === 22) return [[{ name: 'South Shelter' }]];
      return [[]];
    }
    return [[]];
  });

  const north = await runWithShelter(11, () => renderEmailPreviews());
  const south = await runWithShelter(22, () => renderEmailPreviews());

  assert.equal(north.sends_mail, false);
  assert.equal(south.sends_mail, false);
  assert.equal(north.shelter.id, 11);
  assert.equal(south.shelter.id, 22);
  assert.equal(north.shelter.name, 'North Shelter');
  assert.equal(south.shelter.name, 'South Shelter');
  assert.equal(north.previews.length, catalogIds().length);

  const northDigest = north.previews.find((p) => p.id === 'digest');
  const southDigest = south.previews.find((p) => p.id === 'digest');
  assert.match(northDigest.html, /North Shelter/);
  assert.match(northDigest.text, /North Shelter/);
  assert.match(southDigest.html, /South Shelter/);
  assert.match(southDigest.text, /South Shelter/);
  assert.doesNotMatch(northDigest.text, /South Shelter/);
  assert.doesNotMatch(southDigest.text, /North Shelter/);
});

test('listEmailPreviews controller returns catalog without sending', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/SELECT name FROM shelters WHERE id = \?/i.test(sql)) {
      return [[{ name: `Shelter ${params[0]}` }]];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(7, () => listEmailPreviews({ session: { role: 'admin' } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sends_mail, false);
  assert.equal(res.body.shelter.id, 7);
  assert.equal(res.body.previews.length, catalogIds().length);
  for (const preview of res.body.previews) {
    assert.ok(preview.html);
    assert.ok(preview.text);
    assert.ok(preview.subject);
  }
});

test('email preview route and page are wired for admins', () => {
  assert.match(ROUTES, /email-previews/);
  assert.match(ROUTES, /listEmailPreviews/);
  assert.match(NAV, /email-previews\.html/);
  assert.match(NAV, /adminOnly:\s*true/);
  assert.match(PAGE, /never sends mail/i);
  assert.match(PAGE, /emailTypeList/);
  assert.match(PAGE, /detailText/);
  assert.doesNotMatch(PAGE, /rounded-2xl|gradient|emoji/i);
});
