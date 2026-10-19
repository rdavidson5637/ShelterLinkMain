'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.EMAIL_HOST = 'smtp.test.invalid';
process.env.EMAIL_FROM = 'ShelterLink <test@example.com>';

// Capture outgoing mail instead of opening an SMTP connection.
const sent = [];
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath,
  filename: nodemailerPath,
  loaded: true,
  exports: {
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'x' };
      },
    }),
  },
};

const { getBranding, applyBrandingTokens, DEFAULTS } = require('../utils/branding');
const { getPublicConfig } = require('../controllers/publicConfigController');
const emailService = require('../utils/emailService');

const FRONTEND = path.join(__dirname, '..', 'frontend');

const CROSSKENNAN = {
  SHELTER_NAME: 'Crosskennan Lane Animal Sanctuary',
  SHELTER_SHORT_NAME: 'Crosskennan',
  SHELTER_LOCATION: 'Antrim',
  SHELTER_PRIMARY_COLOUR: '#0b5394',
  SHELTER_CONTACT_EMAIL: 'hello@crosskennan.example',
  APP_URL: 'https://volunteer.crosskennan.example',
};

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let out;
  try {
    out = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

const CLEAR = Object.fromEntries(Object.keys(CROSSKENNAN).map((k) => [k, undefined]));

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

async function serve(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function freshRouter() {
  delete require.cache[require.resolve('../routes/seo')];
  return require('../routes/seo');
}

test('defaults are Assisi, with the corrected location', () => {
  withEnv(CLEAR, () => {
    const b = getBranding();
    assert.equal(b.name, 'Assisi Animal Sanctuary');
    assert.equal(b.shortName, 'Assisi');
    assert.equal(b.location, 'Conlig, Newtownards');
    assert.equal(b.primaryColour, '#1b5e20');
  });
});

test('overrides apply, and a custom name never falls back to Assisi values', () => {
  withEnv({ ...CLEAR, SHELTER_NAME: 'Paws Rescue' }, () => {
    const b = getBranding();
    assert.equal(b.name, 'Paws Rescue');
    assert.equal(b.shortName, 'Paws Rescue');
    assert.equal(b.location, '');
    assert.equal(b.websiteUrl, '');
  });
  withEnv(CROSSKENNAN, () => {
    const b = getBranding();
    assert.equal(b.shortName, 'Crosskennan');
    assert.equal(b.primaryColour, '#0b5394');
  });
});

test('invalid colour, url and email are ignored', () => {
  const b = getBranding({
    SHELTER_PRIMARY_COLOUR: 'red;} body{display:none',
    SHELTER_WEBSITE_URL: 'javascript:alert(1)',
    SHELTER_LOGO_URL: '//evil.example/x.png',
    SHELTER_CONTACT_EMAIL: 'not an email',
  });
  assert.equal(b.primaryColour, '#1b5e20');
  assert.equal(b.websiteUrl, 'https://www.assisi-ni.org');
  assert.equal(b.logoUrl, '');
  assert.equal(b.contactEmail, '');
});

test('tokens are HTML-escaped', () => {
  const html = applyBrandingTokens('<p>%%SHELTER_NAME%%</p>', {
    ...DEFAULTS,
    name: '"><script>alert(1)</script>',
  });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('public config exposes branding', () => {
  withEnv(CROSSKENNAN, () => {
    const res = { status: () => res, json: (b) => { res.body = b; return res; } };
    getPublicConfig({}, res);
    assert.equal(res.body.branding.name, 'Crosskennan Lane Animal Sanctuary');
    assert.equal(res.body.branding.location, 'Antrim');
  });
});

test('no served HTML page mentions Assisi when another rescue is configured', async () => {
  await withEnv(CROSSKENNAN, async () => {
    const app = express();
    app.use(freshRouter());
    const server = await serve(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const pages = walk(FRONTEND, '.html').map((f) => '/' + path.relative(FRONTEND, f).split(path.sep).join('/'));
      assert.ok(pages.length > 30, 'expected to find the html pages');
      for (const p of pages) {
        const res = await fetch(base + p);
        assert.equal(res.status, 200, p);
        const html = await res.text();
        assert.ok(!/assisi/i.test(html), `${p} still mentions Assisi`);
        assert.ok(!html.includes('%%'), `${p} has an unfilled token`);
        if (html.includes('</head>')) {
          assert.match(html, /<meta name="shelter-name" content="Crosskennan Lane Animal Sanctuary"/, p);
        }
      }
      const home = await (await fetch(`${base}/`)).text();
      assert.match(home, /<h1>Volunteer at Crosskennan Lane Animal Sanctuary<\/h1>/);
      assert.match(home, /in Antrim,/);
      assert.match(home, /name="theme-color" content="#0b5394"/);
      assert.match(home, /href="https:\/\/volunteer\.crosskennan\.example\/"/);
    } finally {
      server.close();
    }
  });
});

test('default deployment still reads as Assisi, in Conlig', async () => {
  await withEnv(CLEAR, async () => {
    const app = express();
    app.use(freshRouter());
    const server = await serve(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const home = await (await fetch(`${base}/`)).text();
      assert.match(home, /<h1>Volunteer at Assisi Animal Sanctuary<\/h1>/);
      assert.ok(!/Belfast/.test(home));
      assert.match(home, /Conlig, Newtownards/);
    } finally {
      server.close();
    }
  });
});

test('web app manifest is branded and keeps its icons', async () => {
  await withEnv(CROSSKENNAN, async () => {
    const app = express();
    app.use(freshRouter());
    const server = await serve(app);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/public/manifest.webmanifest`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /manifest\+json/);
      const m = await res.json();
      assert.equal(m.description, 'Volunteer shifts and hours for Crosskennan Lane Animal Sanctuary');
      assert.equal(m.theme_color, '#0b5394');
      assert.ok(m.icons.length >= 2);
      assert.ok(!JSON.stringify(m).includes('Assisi'));
    } finally {
      server.close();
    }
  });
});

test('emails use SHELTER_NAME and never say Assisi for another rescue', async () => {
  await withEnv(CROSSKENNAN, async () => {
    sent.length = 0;
    await emailService.sendApplicationConfirmation('v@example.com', 'Dog walking');
    await emailService.sendApplicationApproval('v@example.com', 'Dog walking');
    await emailService.sendApplicationRejection('v@example.com', 'Dog walking');
    await emailService.sendHoursApproval('v@example.com', { hours: 3, opportunityTitle: 'Dog walking' });
    await emailService.sendVolunteerApprovalNotification('v@example.com', 'Val');
    assert.ok(sent.length >= 5);
    for (const mail of sent) {
      assert.ok(!/assisi/i.test(mail.subject + mail.html), `email "${mail.subject}" mentions Assisi`);
    }
    assert.match(sent[0].html, /Crosskennan Lane Animal Sanctuary/);
  });
});

test('client scripts and server code carry no hard-coded Assisi text', () => {
  const files = [
    ...walk(path.join(FRONTEND, 'js'), '.js'),
    ...['utils', 'controllers', 'jobs'].flatMap((d) => walk(path.join(__dirname, '..', d), '.js')),
  ].filter((f) => !f.endsWith(`${path.sep}branding.js`));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/Assisi Animal Sanctuary/.test(src), `${path.relative(path.join(__dirname, '..'), f)} hard-codes the shelter name`);
  }
});
