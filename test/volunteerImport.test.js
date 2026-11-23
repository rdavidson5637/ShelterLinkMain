'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MESSAGE = '1000';

const mock = require('./helpers/mockDb');
const { currentShelterId, isBypass, runWithShelter } = require('../utils/shelterContext');
const { hashResetToken } = require('../utils/resetToken');

const sent = [];
let emailFails = false;
const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    async sendVolunteerSetPasswordInvite(to, options) {
      if (emailFails) throw new Error('SMTP down');
      mock.calls.push({ sql: 'EMAIL', params: [to] });
      sent.push({ to, ...options });
    },
    async sendVolunteerApprovalNotification() {},
  },
};

const { errorHandler } = require('../middleware/errorHandler');
const adminRoutes = require('../routes/admin');
const { readVolunteerCsv, parseCsv, parseDateOfBirth, MAX_ROWS } = require('../utils/volunteerCsv');
const { IMPORTED_NO_PASSWORD, INVITE_STATUS_SQL, isBcryptHash } = require('../utils/importedAccount');

const SHELTER = 3;
const ADMIN = { userId: 9, role: 'admin', shelterId: SHELTER };
const STAFF = { userId: 10, role: 'staff', shelterId: SHELTER };
const ROLES = { 9: 'admin', 10: 'staff', 11: 'volunteer' };
const TODAY = new Date('2026-11-23T12:00:00Z');

mock.pool.getConnection = async () => ({
  async beginTransaction() { mock.calls.push({ sql: 'BEGIN', params: [], ctx: currentShelterId() }); },
  async commit() { mock.calls.push({ sql: 'COMMIT', params: [] }); },
  async rollback() { mock.calls.push({ sql: 'ROLLBACK', params: [] }); },
  execute: (sql, params) => mock.pool.execute(sql, params),
  query: (sql, params) => mock.pool.query(sql, params),
  release() {},
});

const contexts = [];

/**
 * accounts: email -> { userId, here } as the cross-shelter lookup would see.
 * imported: rows the invite SELECT returns.
 */
function scenario({ accounts = {}, imported = [], email = true, insertError = null } = {}) {
  mock.resetCalls();
  contexts.length = 0;
  sent.length = 0;
  emailFails = false;
  if (email) {
    process.env.EMAIL_HOST = 'smtp.example.test';
    process.env.EMAIL_FROM = 'noreply@example.test';
    process.env.APP_URL = 'http://localhost:3000';
  } else {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_FROM;
  }
  let nextId = 500;
  mock.setHandler(async (sql, params) => {
    contexts.push({ sql, params, shelter: currentShelterId(), bypass: isBypass() });
    if (/FROM users\s+WHERE user_id = \?/.test(sql)) {
      const id = Number(params[0]);
      return [ROLES[id] ? [{ user_id: id, name: 'X', email: 'x@example.test', role: ROLES[id], shelter_id: SHELTER }] : []];
    }
    if (/LEFT JOIN memberships m ON m.user_id = u.user_id/.test(sql)) {
      const wanted = params[2];
      return [wanted.filter((e) => accounts[e]).map((e) => ({ user_id: accounts[e].userId, email: e, here: accounts[e].here }))];
    }
    if (/INSERT INTO users/.test(sql)) {
      if (insertError) throw insertError;
      nextId += 1;
      return [Object.assign([{ user_id: nextId }], { insertId: nextId })];
    }
    if (/WHERE user_id = ANY/.test(sql)) return [imported];
    if (/UPDATE users SET reset_token = \?/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO/.test(sql)) return [Object.assign([{ id: 1 }], { insertId: 1 })];
    return [[]];
  });
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const header = req.get('x-test-session');
    req.session = header ? JSON.parse(header) : {};
    if (req.session.shelterId) return runWithShelter(req.session.shelterId, () => next());
    return next();
  });
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, urlPath, { session = ADMIN, csv, body } = {}) {
  const headers = {};
  if (session) headers['x-test-session'] = JSON.stringify(session);
  let payload;
  if (csv !== undefined) {
    headers['content-type'] = 'text/csv';
    payload = csv;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const sqlOf = () => mock.calls.map((c) => c.sql);

// --- CSV reading -----------------------------------------------------------

test('parseCsv handles quotes, doubled quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.throws(() => parseCsv('a,"open\n'), /never closed/);
});

test('header names match loosely and name splits into first and last', () => {
  const { rows } = readVolunteerCsv('﻿Full Name,E-mail Address,Mobile,DOB\nMary Jane Smith,MJ@Example.org,+44 7700 900123,30/04/2001\n', { today: TODAY });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { first: rows[0].first_name, last: rows[0].last_name, email: rows[0].email, phone: rows[0].phone, dob: rows[0].date_of_birth, row: rows[0].row },
    { first: 'Mary Jane', last: 'Smith', email: 'mj@example.org', phone: '+44 7700 900123', dob: '2001-04-30', row: 2 }
  );
  assert.deepEqual(rows[0].errors, []);
  const split = readVolunteerCsv('First name,Surname,email\nSam,Patel,sam@example.org\n').rows[0];
  assert.equal(split.first_name, 'Sam');
  assert.equal(split.last_name, 'Patel');
});

test('a file without an email column or a name column is refused whole', () => {
  assert.throws(() => readVolunteerCsv('name,phone\nSam Patel,0770\n'), /called email/);
  assert.throws(() => readVolunteerCsv('email,phone\nsam@example.org,0770\n'), /name column/);
  assert.throws(() => readVolunteerCsv('name,email\n'), /no volunteers/);
  assert.throws(() => readVolunteerCsv(''), /Choose a CSV/);
});

test('size and row limits', () => {
  const many = ['name,email', ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `Pat Lee,p${i}@example.org`)].join('\n');
  assert.throws(() => readVolunteerCsv(many), /more than 500/);
  const big = `name,email\nPat Lee,p@example.org,${'x'.repeat(260 * 1024)}\n`;
  assert.throws(() => readVolunteerCsv(big), /larger than 256 KB/);
});

test('formula cells are refused, so nothing formula-like is stored or re-exported', () => {
  const csv = [
    'name,email,phone,date of birth',
    '=HYPERLINK("http://x"),a@example.org,,',
    'Sam Patel,@evil@example.org,,',
    'Sam Patel,b@example.org,-1+1,',
    'Sam Patel,c@example.org,=1+1,',
    'Sam Patel,d@example.org,,+2001-01-01',
    '"Sam\tPatel",e@example.org,,',
    'Ok Person,f@example.org,+44 7700 900123,',
  ].join('\n');
  const { rows } = readVolunteerCsv(csv, { today: TODAY });
  for (const row of rows.slice(0, 6)) {
    assert.ok(row.errors.some((e) => /formula|control character|phone should|date of birth/.test(e)), `row ${row.row}: ${row.errors}`);
  }
  assert.deepEqual(rows[6].errors, [], 'a phone starting with + is fine');
  assert.ok(rows.slice(0, 6).every((r) => r.errors.length));
});

test('row problems are listed per row, and a repeated email is flagged on the later row', () => {
  const csv = [
    'name,email,phone,dob',
    'Sam Patel,sam@example.org,,',
    'Sam Again,SAM@example.org,,',
    'Cher,cher@example.org,,',
    'Pat Lee,not-an-email,abc,31/02/2001',
    'Kid Future,kid@example.org,,2030-01-01',
    'Bad <b>Name</b>,bad@example.org,,',
  ].join('\n');
  const { rows } = readVolunteerCsv(csv, { today: TODAY });
  assert.deepEqual(rows[0].errors, []);
  assert.deepEqual(rows[1].errors, ['same email as row 2']);
  assert.deepEqual(rows[2].errors, ['needs a first and last name']);
  assert.equal(rows[3].errors.length, 3);
  assert.match(rows[4].errors[0], /past date/);
  assert.deepEqual(rows[5].errors, ['name contains < or >']);
});

test('dates of birth: ISO or UK order, real past dates only', () => {
  assert.equal(parseDateOfBirth('2001-04-30', TODAY), '2001-04-30');
  assert.equal(parseDateOfBirth('1/2/1990', TODAY), '1990-02-01');
  assert.equal(parseDateOfBirth('29/02/2001', TODAY), null);
  assert.equal(parseDateOfBirth('2026-11-23', TODAY), null);
  assert.equal(parseDateOfBirth('1850-01-01', TODAY), null);
  assert.equal(parseDateOfBirth('April 2001', TODAY), null);
});

// --- Who may call ----------------------------------------------------------

test('only admins import; staff and admins send invites; volunteers and signed-out get nothing', async () => {
  const csv = 'name,email\nSam Patel,sam@example.org\n';
  for (const [label, session, importStatus, inviteStatus] of [
    ['staff', STAFF, 403, 200],
    ['volunteer', { userId: 11, role: 'volunteer', shelterId: SHELTER }, 403, 403],
    ['signed out', null, 401, 401],
  ]) {
    for (const p of ['/volunteers/import/preview', '/volunteers/import']) {
      scenario();
      const res = await call('POST', p, { session, csv });
      assert.equal(res.status, importStatus, `${label} ${p}`);
      assert.ok(!sqlOf().some((s) => /INSERT INTO users|memberships/.test(s)), `${label} touched users`);
    }
    scenario();
    const invite = await call('POST', '/volunteers/invites', { session, body: { user_ids: [501] } });
    assert.equal(invite.status, inviteStatus, `${label} invites`);
  }
});

// --- Preview ---------------------------------------------------------------

const MIXED = [
  'name,email,phone,date of birth',
  'New Person,new@example.org,07700 900123,30/04/2001',
  'Other Shelter,elsewhere@example.org,,',
  'Already Here,here@example.org,,',
  'Broken,broken,,',
].join('\n');
const MIXED_ACCOUNTS = {
  'elsewhere@example.org': { userId: 77, here: false },
  'here@example.org': { userId: 78, here: true },
};

test('preview sorts every row into new, link, duplicate or error and writes nothing', async () => {
  scenario({ accounts: MIXED_ACCOUNTS });
  const res = await call('POST', '/volunteers/import/preview', { csv: MIXED });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows.map((r) => [r.row, r.outcome]), [[2, 'new'], [3, 'link'], [4, 'duplicate'], [5, 'error']]);
  assert.deepEqual(res.body.summary, { total: 4, new: 1, link: 1, duplicate: 1, error: 1 });
  assert.equal(res.body.rows[0].date_of_birth, '2001-04-30');
  assert.equal(res.body.rows[1].userId, undefined, 'no other-shelter user id goes to the browser');

  const lookup = contexts.find((c) => /LEFT JOIN memberships/.test(c.sql));
  assert.ok(lookup.bypass, 'the account check spans every shelter');
  assert.deepEqual(lookup.params.slice(0, 2), [SHELTER, SHELTER], 'the shelter comes from the session');
  assert.deepEqual(lookup.params[2], ['new@example.org', 'elsewhere@example.org', 'here@example.org'], 'only valid rows are looked up');
  assert.doesNotMatch(lookup.sql, /first_name|last_name|phone|role/, 'the lookup reads no details of the other account');

  assert.ok(!sqlOf().some((s) => /INSERT INTO (users|memberships|volunteer_profiles)/.test(s)));
  const audit = mock.calls.find((c) => /INSERT INTO audit_log/.test(c.sql));
  assert.equal(audit.params[1], 'volunteer.import.preview');
  assert.equal(mock.calls.filter((c) => /INSERT INTO audit_log/.test(c.sql)).length, 1, 'one audit row, not a second generic one');
  assert.ok(!sent.length);
});

test('preview refuses a JSON body, a bad file and an oversized upload', async () => {
  scenario();
  const json = await call('POST', '/volunteers/import/preview', { body: { csv: 'name,email' } });
  assert.equal(json.status, 415);
  scenario();
  const bad = await call('POST', '/volunteers/import/preview', { csv: 'phone\n0770\n' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /email/);
  scenario();
  const huge = await call('POST', '/volunteers/import/preview', { csv: `name,email\n${'x'.repeat(300 * 1024)}` });
  assert.equal(huge.status, 413);
  assert.match(huge.body.error, /256 KB/);
});

// --- Import ----------------------------------------------------------------

test('import creates new rows with no password, links existing logins, audits in the same transaction, emails nobody', async () => {
  scenario({ accounts: MIXED_ACCOUNTS });
  const res = await call('POST', '/volunteers/import', { csv: MIXED });
  assert.equal(res.status, 201);
  assert.deepEqual(
    { created: res.body.created, linked: res.body.linked, dup: res.body.skipped_duplicates, err: res.body.skipped_errors },
    { created: 1, linked: 1, dup: 1, err: 1 }
  );

  const insert = mock.calls.find((c) => /INSERT INTO users/.test(c.sql));
  assert.deepEqual(insert.params, ['New', 'Person', 'New Person', '07700 900123', 'new@example.org', IMPORTED_NO_PASSWORD, SHELTER]);
  assert.match(insert.sql, /'volunteer'/);
  const profile = mock.calls.find((c) => /INSERT INTO volunteer_profiles/.test(c.sql));
  assert.deepEqual(profile.params, [501, '2001-04-30', SHELTER]);
  const link = mock.calls.find((c) => /INSERT INTO memberships/.test(c.sql));
  assert.deepEqual(link.params, [77, SHELTER]);
  assert.match(link.sql, /ON CONFLICT \(user_id, shelter_id\) DO NOTHING/, 'never changes an existing role');
  assert.ok(!sqlOf().some((s) => /UPDATE users/.test(s)), 'the linked account is not edited');

  const writes = contexts.filter((c) => /INSERT INTO (users|memberships|volunteer_profiles|audit_log)/.test(c.sql));
  assert.ok(writes.every((c) => c.shelter === SHELTER && !c.bypass), 'writes run inside the shelter');

  const sql = sqlOf();
  const audit = mock.calls.find((c) => /'volunteer\.import'/.test(c.sql));
  assert.ok(sql.indexOf(audit.sql) < sql.indexOf('COMMIT'), 'audit row is inside the transaction');
  const detail = JSON.parse(audit.params[1]);
  assert.deepEqual(detail.created_user_ids, [501]);
  assert.deepEqual(detail.linked_user_ids, [77]);
  assert.equal(JSON.stringify(detail).includes('@'), false, 'no emails in the audit detail');
  assert.equal(mock.calls.filter((c) => /INSERT INTO audit_log/.test(c.sql)).length, 1);
  assert.ok(!sql.includes('EMAIL') && !sent.length, 'the import emails nobody');
});

test('import with nothing importable writes nothing; a race on an email rolls back', async () => {
  scenario({ accounts: { 'here@example.org': { userId: 78, here: true } } });
  const none = await call('POST', '/volunteers/import', { csv: 'name,email\nAlready Here,here@example.org\nBroken,x\n' });
  assert.equal(none.status, 400);
  assert.ok(!sqlOf().some((s) => /BEGIN|INSERT/.test(s)));

  const dupe = Object.assign(new Error('duplicate key'), { code: '23505' });
  scenario({ insertError: dupe });
  const race = await call('POST', '/volunteers/import', { csv: 'name,email\nSam Patel,sam@example.org\n' });
  assert.equal(race.status, 409);
  assert.ok(sqlOf().includes('ROLLBACK'));
  assert.ok(!sqlOf().includes('COMMIT'));
});

// --- Invites ---------------------------------------------------------------

test('invites go only to imported volunteers at this shelter, with a reset link that matches the stored hash', async () => {
  scenario({ imported: [{ user_id: 501, email: 'new@example.org', first_name: 'New' }] });
  const res = await call('POST', '/volunteers/invites', { session: STAFF, body: { user_ids: [501, '502', 501] } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: 1, failed: 0, skipped: 1 });

  const select = contexts.find((c) => /WHERE user_id = ANY/.test(c.sql));
  assert.deepEqual(select.params, [[501, 502], SHELTER, IMPORTED_NO_PASSWORD]);
  assert.match(select.sql, /role = 'volunteer'/);
  assert.ok(select.shelter === SHELTER && !select.bypass);

  const update = mock.calls.find((c) => /UPDATE users SET reset_token = \?/.test(c.sql));
  const [hash, expires, userId, shelterId, marker] = update.params;
  assert.equal(userId, 501);
  assert.equal(shelterId, SHELTER);
  assert.equal(marker, IMPORTED_NO_PASSWORD, 'never overwrites the token of someone who set a password meanwhile');
  const days = (new Date(expires) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'new@example.org');
  const token = /\/reset-password\.html\?token=([a-f0-9]{64})$/.exec(sent[0].link)[1];
  assert.equal(hashResetToken(token), hash);

  const audit = mock.calls.find((c) => /INSERT INTO audit_log/.test(c.sql));
  assert.equal(audit.params[1], 'volunteer.invite.send');
  assert.equal(mock.calls.filter((c) => /INSERT INTO audit_log/.test(c.sql)).length, 1);
});

test('a failed email clears its token; no email set up means nothing is touched', async () => {
  scenario({ imported: [{ user_id: 501, email: 'new@example.org', first_name: 'New' }] });
  emailFails = true;
  const res = await call('POST', '/volunteers/invites', { body: { user_ids: [501] } });
  assert.deepEqual(res.body, { sent: 0, failed: 1, skipped: 0 });
  assert.ok(sqlOf().some((s) => /SET reset_token = NULL, reset_token_expires = NULL/.test(s)));

  scenario({ email: false, imported: [{ user_id: 501, email: 'new@example.org' }] });
  const off = await call('POST', '/volunteers/invites', { body: { user_ids: [501] } });
  assert.equal(off.status, 409);
  assert.ok(!sqlOf().some((s) => /reset_token|WHERE user_id = ANY/.test(s)));

  scenario();
  const tooMany = await call('POST', '/volunteers/invites', { body: { user_ids: Array.from({ length: 101 }, (_, i) => i + 1) } });
  assert.equal(tooMany.status, 400);
  const extra = await call('POST', '/volunteers/invites', { body: { user_ids: [1], shelter_id: 1 } });
  assert.equal(extra.status, 400);
});

// --- No password -----------------------------------------------------------

test('the imported marker is not a hash, so no password signs in as an imported volunteer', async () => {
  assert.equal(isBcryptHash(IMPORTED_NO_PASSWORD), false);
  assert.equal(isBcryptHash(bcrypt.hashSync('x', 4)), true);
  assert.equal(await bcrypt.compare(IMPORTED_NO_PASSWORD, IMPORTED_NO_PASSWORD).catch(() => false), false);

  const { login } = require('../controllers/authController');
  mock.setHandler(async (sql) => {
    if (/FROM users\s+WHERE lower\(email\)/.test(sql)) {
      return [[{ user_id: 501, email: 'new@example.org', password: IMPORTED_NO_PASSWORD, role: 'volunteer', shelter_id: SHELTER }]];
    }
    return [[]];
  });
  const res = await new Promise((resolve) => {
    const out = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    login({ body: { email: 'new@example.org', password: IMPORTED_NO_PASSWORD }, session: {} }, out);
  });
  assert.equal(res.status, 401);
});

test('the volunteers list reports invite state for imported rows only', () => {
  assert.match(INVITE_STATUS_SQL, /WHEN u\.password <> '!imported:no-password' THEN NULL/);
  assert.match(INVITE_STATUS_SQL, /'not_invited'/);
  assert.match(INVITE_STATUS_SQL, /'invited'/);
  assert.match(INVITE_STATUS_SQL, /'invite_expired'/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'profileController.js'), 'utf8');
  assert.match(source, /\$\{INVITE_STATUS_SQL\} AS invite_status/);
});

// --- Pages -----------------------------------------------------------------

test('the import page is ruled tables and rows, renders file text safely, and the directory links to it', () => {
  const root = path.join(__dirname, '..', 'frontend');
  const html = fs.readFileSync(path.join(root, 'pages', 'admin', 'volunteer-import.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'js', 'admin', 'volunteer-import.js'), 'utf8');
  assert.match(html, /<table>/);
  assert.match(html, /accept="\.csv,text\/csv"/);
  assert.doesNotMatch(html, /card|grid|gradient|emoji/i);
  assert.doesNotMatch(js, /innerHTML/, 'file contents only ever go in via textContent');
  assert.match(js, /'Content-Type': 'text\/csv'/);

  const directory = fs.readFileSync(path.join(root, 'pages', 'admin', 'volunteers.html'), 'utf8');
  assert.match(directory, /<li data-admin-only hidden>[\s\S]*href="\/pages\/admin\/volunteer-import\.html"/);
  assert.match(directory, /id="sendInvitesButton"/);
  const directoryJs = fs.readFileSync(path.join(root, 'js', 'admin', 'volunteers.js'), 'utf8');
  assert.match(directoryJs, /apiRequest\('\/admin\/volunteers\/invites'/);
  assert.match(directoryJs, /not_invited: 'Not yet invited'/);
});
