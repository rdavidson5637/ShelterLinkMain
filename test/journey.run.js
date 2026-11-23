'use strict';

// End-to-end volunteer journey (SL-LATER-36), against a real local Postgres.
//
// Shelter A (Assisi, approval mode):
//   admin posts a shift -> a volunteer registers, completes a profile, the
//   admin approves the profile -> the volunteer books (pending) -> staff accept
//   -> the volunteer checks in and out with the QR poster code -> the check-out
//   logs verified hours -> staff approve them -> the impact report and the
//   hours statement include them (and did not before approval).
// Shelter B (instant mode):
//   admin switches to instant booking and marks a volunteer trusted -> the
//   volunteer's booking is confirmed straight away, with no staff step.
// Shelter C (bystander) sees none of it, and A and B do not see each other.
//
// Local Postgres only: the helpers refuse any other host or database name.
// CI sets TENANT_DATABASE_URL to its localhost service container; this file
// uses a separate database on that container. Elsewhere it starts a
// throwaway cluster with initdb.

const DB_NAME = 'shelterlink_journey_test';
const PG_PORT = 54330;
const DATA_DIR = '/tmp/shelterlink-journey-pg';

const live = require('./helpers/liveDb');

const SERVICE_URL = process.env.JOURNEY_DATABASE_URL
  || (process.env.TENANT_DATABASE_URL ? live.withDatabase(process.env.TENANT_DATABASE_URL, DB_NAME) : '');
const USE_SERVICE = Boolean(SERVICE_URL);
const LOCAL = USE_SERVICE ? SERVICE_URL : `postgresql://postgres@127.0.0.1:${PG_PORT}/${DB_NAME}`;
live.assertLocalTestUrl(LOCAL, DB_NAME);

process.env.DATABASE_URL = LOCAL;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'journey-test-secret-value-not-real';
process.env.PORT = '0';
// Node's local time is the shelter's local time, as on a correctly set host.
process.env.TZ = process.env.SHELTER_TIMEZONE || 'Europe/London';

const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const STAFF_PASSWORD = 'Journey-staff-pass-1';
const VOLUNTEER_PASSWORD = 'Journey-volunteer-pass-1';
const SHIFT_A = 'Journey kennel round A';
const SHIFT_B = 'Journey cattery round B';
const VOL_A = { first_name: 'Ivy', last_name: 'Journeyman', email: 'ivy.journey@example.test' };
const VOL_B = { first_name: 'Theo', last_name: 'Trusted', email: 'theo.trusted@example.test' };

function pad(n) {
  return String(n).padStart(2, '0');
}

function localSql(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A shift starting shortly, kept on today's date so the check-in window is
// open and hours for it are not in the future.
function shiftTimes() {
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const latest = new Date();
  latest.setHours(23, 0, 0, 0);
  const s = start > latest ? latest : start;
  const e = new Date(s.getTime() + 2 * 60 * 60 * 1000);
  return { start_date: localSql(s), end_date: localSql(e) };
}

function rows(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const key of ['volunteers', 'applications', 'opportunities', 'hours', 'rows', 'data', 'items']) {
      if (Array.isArray(body[key])) return body[key];
    }
  }
  return [];
}

async function seed(admin) {
  const hash = bcrypt.hashSync(STAFF_PASSWORD, 4);
  await admin.query(`
    INSERT INTO shelters (id, name, slug) VALUES
      (2, 'Hillside Rescue', 'hillside'),
      (3, 'Bystander Shelter', 'bystander')
  `);
  await admin.query(
    `INSERT INTO users (user_id, first_name, last_name, name, email, password, role, shelter_id) VALUES
       (1, 'Alma', 'Admin', 'Alma Admin', 'a.admin@example.test', $1, 'admin', 1),
       (2, 'Sam', 'Staff', 'Sam Staff', 'a.staff@example.test', $1, 'staff', 1),
       (3, 'Bea', 'Admin', 'Bea Admin', 'b.admin@example.test', $1, 'admin', 2),
       (4, 'Cal', 'Admin', 'Cal Admin', 'c.admin@example.test', $1, 'admin', 3)`,
    [hash]
  );
  await admin.query(`SELECT setval(pg_get_serial_sequence('users', 'user_id'), (SELECT MAX(user_id) FROM users))`);
  await admin.query(`SELECT setval(pg_get_serial_sequence('shelters', 'id'), (SELECT MAX(id) FROM shelters))`);
}

function makeClient(port) {
  return {
    async login(email, password) {
      const res = await live.request(port, 'POST', '/api/auth/login', { json: { email, password } });
      assert.equal(res.status, 200, `login ${email} -> ${res.status} ${res.text.slice(0, 200)}`);
      const cookie = live.sessionCookie(res.setCookie);
      assert.ok(cookie, `login ${email} set no session cookie`);
      const call = (method, urlPath, json) => live.request(port, method, urlPath, { json, cookie });
      return {
        get: (p) => call('GET', p),
        post: (p, j) => call('POST', p, j),
        put: (p, j) => call('PUT', p, j),
      };
    },
    register(person, slug) {
      return live.request(port, 'POST', '/api/auth/register', {
        json: {
          ...person,
          password: VOLUNTEER_PASSWORD,
          privacy_notice: true,
          ...(slug ? { shelter_slug: slug } : {}),
        },
      });
    },
  };
}

function expectStatus(res, status, label) {
  assert.equal(res.status, status, `${label} -> ${res.status} ${res.text.slice(0, 300)}`);
  return res.body;
}

function mustNotMention(res, needles, label) {
  for (const needle of needles) {
    assert.ok(!res.text.includes(needle), `${label} leaked "${needle}": ${res.text.slice(0, 300)}`);
  }
}

async function journey(port, admin) {
  const http = makeClient(port);
  const today = todayIso();
  const range = `startDate=${today}&endDate=${today}`;
  const steps = [];
  const step = (name) => steps.push(name);

  // --- Shelter A: approval mode (no booking policy row means approval) -----
  const adminA = await http.login('a.admin@example.test', STAFF_PASSWORD);
  const staffA = await http.login('a.staff@example.test', STAFF_PASSWORD);

  const booking = expectStatus(await adminA.get('/api/admin/settings/booking'), 200, 'A booking settings');
  assert.equal(booking.booking_mode, 'approval', `A booking mode ${JSON.stringify(booking)}`);

  const times = shiftTimes();
  const shiftA = expectStatus(await adminA.post('/api/opportunities', {
    title: SHIFT_A,
    description: 'Morning kennel round and walks.',
    location: 'Kennel block',
    max_volunteers: 3,
    ...times,
  }), 201, 'A admin posts shift');
  const shiftAId = shiftA.opportunity_id;
  assert.ok(shiftAId, `shift A has no id ${JSON.stringify(shiftA)}`);
  step('admin posts a shift');

  expectStatus(await http.register(VOL_A, 'assisi'), 201, 'volunteer A registers');
  const volA = await http.login(VOL_A.email, VOLUNTEER_PASSWORD);
  const me = expectStatus(await volA.get('/api/auth/me'), 200, 'volunteer A me');
  const volAId = Number((me.user && me.user.user_id) || me.user_id || (me.user && me.user.id) || me.id);
  assert.ok(volAId > 0, `volunteer A id from /me ${JSON.stringify(me).slice(0, 200)}`);
  step('volunteer registers');

  const early = await volA.post('/api/applications', { opportunityId: shiftAId });
  assert.equal(early.status, 403, `booking before profile -> ${early.status} ${early.text.slice(0, 200)}`);

  expectStatus(await volA.post('/api/volunteer/profile', {
    date_of_birth: '1990-04-12',
    address: '12 Orchard Road',
    emergency_contact: 'Rae Journeyman 07700 900111',
    skills: 'Dog walking',
    availability: 'Weekends',
  }), 201, 'volunteer A completes profile');
  const pendingProfile = await volA.post('/api/applications', { opportunityId: shiftAId });
  assert.equal(pendingProfile.status, 403, `booking before profile approval -> ${pendingProfile.status}`);

  const listed = rows(expectStatus(await adminA.get('/api/admin/volunteers'), 200, 'A volunteer list'));
  assert.ok(
    listed.some((v) => Number(v.user_id || v.id) === volAId),
    `A admin cannot see the new volunteer: ${JSON.stringify(listed).slice(0, 300)}`
  );
  expectStatus(await adminA.put(`/api/admin/volunteers/${volAId}/approval`, { approved: true }), 200, 'A admin approves profile');
  step('volunteer completes profile and is approved');

  const bookedA = expectStatus(await volA.post('/api/applications', { opportunityId: shiftAId }), 201, 'volunteer A books');
  assert.equal(bookedA.status, 'pending', `approval-mode booking status ${bookedA.status}`);
  step('volunteer books (pending)');

  const queue = rows(expectStatus(await staffA.get('/api/applications'), 200, 'A staff application list'));
  const appA = queue.find((a) => Number(a.user_id) === volAId && Number(a.opportunity_id) === Number(shiftAId));
  assert.ok(appA, `staff cannot see the pending booking: ${JSON.stringify(queue).slice(0, 300)}`);
  assert.equal(appA.status, 'pending');
  const appAId = appA.application_id || appA.id;
  expectStatus(await staffA.put(`/api/applications/${appAId}`, { status: 'accepted' }), 200, 'A staff accepts booking');
  const mine = rows(expectStatus(await volA.get('/api/applications/my-applications'), 200, 'volunteer A applications'));
  const mineA = mine.find((a) => Number(a.opportunity_id) === Number(shiftAId));
  assert.equal(mineA && mineA.status, 'accepted', `volunteer sees ${JSON.stringify(mineA)}`);
  step('staff approve the booking');

  // QR check-in: staff print the poster; the volunteer scans it.
  const poster = expectStatus(await staffA.get(`/api/checkin/poster/${shiftAId}`), 200, 'A staff poster');
  const scanned = new URL(poster.check_in_url);
  assert.equal(scanned.pathname, '/pages/volunteer/checkin.html');
  assert.equal(scanned.searchParams.get('shift'), String(shiftAId));
  const code = new URLSearchParams(scanned.hash.slice(1)).get('code');
  assert.equal(code, poster.check_in_code);
  const wrong = await volA.post(`/api/checkin/shifts/${shiftAId}/check-in`, { code: 'ZZZZZZ' });
  assert.equal(wrong.status, 400, `wrong code -> ${wrong.status}`);
  expectStatus(await volA.post(`/api/checkin/shifts/${shiftAId}/check-in`, { code }), 200, 'volunteer A QR check-in');
  const status = expectStatus(await volA.get(`/api/checkin/shifts/${shiftAId}`), 200, 'volunteer A check-in status');
  assert.ok(JSON.stringify(status).includes('checked_in'), `check-in status ${JSON.stringify(status)}`);
  step('volunteer checks in by QR code');

  // Two hours pass on shift. Move the stored check-in back rather than wait.
  await admin.query(
    `UPDATE applications SET checked_in_at = checked_in_at - interval '2 hours' WHERE application_id = $1`,
    [appAId]
  );
  const out = expectStatus(await volA.post(`/api/checkin/shifts/${shiftAId}/check-out`, { code }), 200, 'volunteer A QR check-out');
  assert.ok(out.hours, `check-out logged no hours ${JSON.stringify(out)}`);
  assert.equal(Number(out.hours.hours), 2);
  step('hours are logged at check-out');

  // Not approved yet: neither the report nor the statement counts them.
  const reportBefore = expectStatus(await adminA.get(`/api/admin/reports/impact?${range}`), 200, 'A impact before');
  assert.equal(reportBefore.summary.approvedHours, 0, `unapproved hours in report ${JSON.stringify(reportBefore.summary)}`);
  const stmtBefore = expectStatus(await volA.get(`/api/volunteer/hours-statement?${range}`), 200, 'A statement before');
  assert.equal(stmtBefore.total_hours, 0, `unapproved hours in statement ${JSON.stringify(stmtBefore)}`);

  const pendingHours = rows(expectStatus(await staffA.get('/api/hours/pending'), 200, 'A pending hours'));
  const entry = pendingHours.find((h) => Number(h.user_id) === volAId);
  assert.ok(entry, `staff cannot see the pending hours ${JSON.stringify(pendingHours).slice(0, 300)}`);
  expectStatus(await staffA.put(`/api/hours/${entry.record_id || entry.id}/approve`, {}), 200, 'A staff approves hours');
  step('staff approve the hours');

  const report = expectStatus(await adminA.get(`/api/admin/reports/impact?${range}`), 200, 'A impact report');
  assert.equal(report.summary.approvedHours, 2, `impact ${JSON.stringify(report.summary)}`);
  assert.equal(report.summary.checkinVerifiedHours, 2);
  assert.equal(report.summary.volunteers, 1);
  assert.equal(report.summary.shifts, 1);
  const csv = expectStatus(await adminA.get(`/api/admin/reports/impact.csv?${range}`), 200, 'A impact csv');
  void csv;
  step('impact report includes the hours');

  const stmt = expectStatus(await volA.get(`/api/volunteer/hours-statement?${range}`), 200, 'A hours statement');
  assert.equal(stmt.total_hours, 2, `statement ${JSON.stringify(stmt)}`);
  assert.equal(stmt.shift_count, 1);
  assert.ok(JSON.stringify(stmt.shifts).includes(SHIFT_A), `statement shifts ${JSON.stringify(stmt.shifts)}`);
  const staffStmt = expectStatus(
    await staffA.get(`/api/admin/volunteers/${volAId}/hours-statement?${range}`), 200, 'A staff-issued statement'
  );
  assert.equal(staffStmt.total_hours, 2);
  step('hours statement includes the hours');

  // --- Shelter B: instant mode, trusted volunteer --------------------------
  const adminB = await http.login('b.admin@example.test', STAFF_PASSWORD);
  expectStatus(await adminB.put('/api/admin/settings/booking', { booking_mode: 'instant' }), 200, 'B switches to instant');
  const shiftB = expectStatus(await adminB.post('/api/opportunities', {
    title: SHIFT_B,
    description: 'Cattery clean and feed.',
    location: 'Cattery',
    max_volunteers: 2,
    ...shiftTimes(),
  }), 201, 'B admin posts shift');
  const shiftBId = shiftB.opportunity_id;

  expectStatus(await http.register(VOL_B, 'hillside'), 201, 'volunteer B registers');
  const volB = await http.login(VOL_B.email, VOLUNTEER_PASSWORD);
  const meB = expectStatus(await volB.get('/api/auth/me'), 200, 'volunteer B me');
  const volBId = Number((meB.user && meB.user.user_id) || meB.user_id || (meB.user && meB.user.id) || meB.id);
  expectStatus(await volB.post('/api/volunteer/profile', {
    date_of_birth: '1985-09-30',
    address: '3 Mill Lane',
    emergency_contact: 'Kim Trusted 07700 900222',
    availability: 'Flexible',
  }), 201, 'volunteer B completes profile');
  expectStatus(await adminB.put(`/api/admin/volunteers/${volBId}/approval`, { approved: true }), 200, 'B approves profile');
  const crossTrust = await adminB.put(`/api/admin/volunteers/${volAId}/trusted`, { trusted: true });
  assert.ok([403, 404].includes(crossTrust.status), `B trusting A's volunteer -> ${crossTrust.status}`);
  expectStatus(await adminB.put(`/api/admin/volunteers/${volBId}/trusted`, { trusted: true }), 200, 'B marks trusted');

  const bookedB = expectStatus(await volB.post('/api/applications', { opportunityId: shiftBId }), 201, 'volunteer B books');
  assert.equal(bookedB.status, 'accepted', `instant booking status ${bookedB.status}`);
  const mineB = rows(expectStatus(await volB.get('/api/applications/my-applications'), 200, 'volunteer B applications'));
  assert.equal(mineB.find((a) => Number(a.opportunity_id) === Number(shiftBId))?.status, 'accepted');
  step('trusted volunteer books instantly');

  // Shelter A's policy is untouched by B's switch.
  const bookingAfter = expectStatus(await adminA.get('/api/admin/settings/booking'), 200, 'A booking settings after');
  assert.equal(bookingAfter.booking_mode, 'approval');

  // --- Isolation: A and B do not see each other; C sees none of it ---------
  const crossVol = await volA.post('/api/applications', { opportunityId: shiftBId });
  assert.ok([403, 404].includes(crossVol.status), `A volunteer booking B shift -> ${crossVol.status}`);
  const crossVolB = await volB.get(`/api/opportunities/${shiftAId}`);
  assert.ok([403, 404].includes(crossVolB.status), `B volunteer reading A shift -> ${crossVolB.status}`);

  const adminC = await http.login('c.admin@example.test', STAFF_PASSWORD);
  const secrets = [SHIFT_A, SHIFT_B, VOL_A.email, VOL_B.email, VOL_A.last_name, VOL_B.last_name];
  const looks = [
    ['B', adminB, '/api/opportunities', [SHIFT_A, VOL_A.email, VOL_A.last_name]],
    ['B', adminB, '/api/admin/volunteers', [VOL_A.email, VOL_A.last_name]],
    ['B', adminB, '/api/applications', [SHIFT_A, VOL_A.email]],
    ['A', adminA, '/api/opportunities', [SHIFT_B, VOL_B.email]],
    ['A', adminA, '/api/admin/volunteers', [VOL_B.email, VOL_B.last_name]],
    ['C', adminC, '/api/opportunities', secrets],
    ['C', adminC, '/api/admin/volunteers', secrets],
    ['C', adminC, '/api/applications', secrets],
    ['C', adminC, '/api/hours/pending', secrets],
    ['C', adminC, `/api/admin/day-sheet?date=${today}`, secrets],
    ['C', adminC, '/api/admin/week-sheet', secrets],
    ['C', adminC, '/api/export/hours', secrets],
    ['C', adminC, '/api/public/opportunities', secrets],
  ];
  for (const [who, client, urlPath, needles] of looks) {
    const res = await client.get(urlPath);
    assert.equal(res.status, 200, `${who} GET ${urlPath} -> ${res.status} ${res.text.slice(0, 200)}`);
    mustNotMention(res, needles, `${who} GET ${urlPath}`);
  }

  const reportC = expectStatus(await adminC.get(`/api/admin/reports/impact?${range}`), 200, 'C impact report');
  assert.deepEqual(
    [reportC.summary.approvedHours, reportC.summary.volunteers, reportC.summary.shifts],
    [0, 0, 0],
    `C impact report counts another shelter ${JSON.stringify(reportC.summary)}`
  );
  const reportB = expectStatus(await adminB.get(`/api/admin/reports/impact?${range}`), 200, 'B impact report');
  assert.equal(reportB.summary.approvedHours, 0, `B impact report counts A hours ${JSON.stringify(reportB.summary)}`);

  const denied = [
    ['C', adminC, `/api/admin/volunteers/${volAId}/hours-statement?${range}`],
    ['C', adminC, `/api/admin/volunteers/${volAId}`],
    ['C', adminC, `/api/opportunities/${shiftAId}`],
    ['C', adminC, `/api/opportunities/${shiftBId}`],
    ['C', adminC, `/api/checkin/poster/${shiftAId}`],
    ['B', adminB, `/api/admin/volunteers/${volAId}/hours-statement?${range}`],
    ['B', adminB, `/api/checkin/poster/${shiftAId}`],
  ];
  for (const [who, client, urlPath] of denied) {
    const res = await client.get(urlPath);
    assert.ok([403, 404].includes(res.status), `${who} GET ${urlPath} -> ${res.status} ${res.text.slice(0, 200)}`);
    mustNotMention(res, secrets, `${who} GET ${urlPath}`);
  }
  const approveC = await adminC.put(`/api/hours/${entry.record_id || entry.id}/approve`, {});
  assert.ok([403, 404].includes(approveC.status), `C approving A hours -> ${approveC.status}`);
  const acceptC = await adminC.put(`/api/applications/${appAId}`, { status: 'rejected' });
  assert.ok([403, 404].includes(acceptC.status), `C changing A booking -> ${acceptC.status}`);
  step('other shelters see none of it');

  // The rows themselves stayed where they belong.
  const placed = await admin.query(`
    SELECT
      (SELECT shelter_id FROM users WHERE user_id = $1) AS vol_a,
      (SELECT shelter_id FROM users WHERE user_id = $2) AS vol_b,
      (SELECT shelter_id FROM applications WHERE application_id = $3) AS app_a,
      (SELECT status FROM applications WHERE application_id = $3) AS app_a_status,
      (SELECT count(*)::int FROM volunteer_hours WHERE shelter_id = 1 AND approved = 1) AS hours_a,
      (SELECT count(*)::int FROM volunteer_hours WHERE shelter_id <> 1) AS hours_other,
      (SELECT count(*)::int FROM opportunities WHERE shelter_id = 3) AS shifts_c
  `, [volAId, volBId, appAId]);
  assert.deepEqual(placed.rows[0], {
    vol_a: 1, vol_b: 2, app_a: 1, app_a_status: 'accepted', hours_a: 1, hours_other: 0, shifts_c: 0,
  });

  return steps;
}

async function main() {
  let cluster = null;
  let admin;
  let httpServer;
  let closePool;
  try {
    if (USE_SERVICE) await live.resetServiceDatabase(LOCAL, DB_NAME);
    else cluster = live.startCluster({ dataDir: DATA_DIR, port: PG_PORT, dbName: DB_NAME });
    admin = new Client({ connectionString: LOCAL });
    await admin.connect();
    await live.applySchema(admin);
    await seed(admin);

    const started = require('../server');
    closePool = require('../config/database').closePool;
    httpServer = await new Promise((resolve) => {
      const server = started.app.listen(0, '127.0.0.1', () => resolve(server));
    });
    const steps = await journey(httpServer.address().port, admin);
    console.log(`Journey passed (${steps.length} steps): ${steps.join('; ')}.`);
  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(() => resolve()));
    if (closePool) {
      try { await closePool(); } catch (error) { console.error(error.message); }
    }
    if (admin) {
      try { await admin.end(); } catch { /* already closed */ }
    }
    if (USE_SERVICE) {
      try { await live.dropServiceDatabase(LOCAL, DB_NAME); } catch (error) { console.error(error.message); }
    }
    if (cluster) cluster.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}).finally(() => {
  process.exit(process.exitCode || 0);
});
