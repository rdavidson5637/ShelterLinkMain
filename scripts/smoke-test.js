#!/usr/bin/env node
/**
 * ShelterLink — End-to-end API smoke test
 * ---------------------------------------------------------------------------
 * Exercises the full volunteer lifecycle against a RUNNING server and reports
 * pass/fail for each step. Use it to confirm a fresh setup actually works
 * end-to-end (DB, auth, sessions, business rules).
 *
 * Prerequisites:
 *   1. Database built with sample data:   npm run db:reset
 *      (the test signs in as the seeded admin admin@shelterlink.org / Admin123!)
 *   2. Server running in another terminal: npm run dev
 *
 * Run:
 *   npm run smoke
 *   # or target a different host/creds:
 *   SMOKE_BASE_URL=http://localhost:3000 \
 *   SMOKE_ADMIN_EMAIL=admin@shelterlink.org SMOKE_ADMIN_PASSWORD=Admin123! \
 *   node scripts/smoke-test.js
 *
 * Exit code 0 = all steps passed, 1 = one or more failed.
 * Note: each run creates one new volunteer + one opportunity in the database.
 */

const BASE = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || 'admin@shelterlink.org';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'Admin123!';

let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`);
  }
  return cond;
}

/** Extract the connect.sid cookie from a response's Set-Cookie header(s). */
function readCookie(res) {
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of list) {
    const m = /connect\.sid=[^;]+/.exec(c || '');
    if (m) return m[0];
  }
  return null;
}

async function req(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, cookie: readCookie(res) };
}

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function futureDate(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(hour)}:00:00`;
}

async function main() {
  console.log(`ShelterLink smoke test → ${BASE}\n`);

  // 0. Health check
  const health = await req('GET', '/api');
  if (!ok('API is reachable', health.status === 200, `got ${health.status} — is the server running?`)) {
    console.log('\nAborting: server not reachable.');
    process.exit(1);
  }

  const stamp = Date.now();
  const volEmail = `smoke.vol.${stamp}@example.com`;

  // 1. Register a new volunteer (with phone — verifies phone is accepted/stored)
  const reg = await req('POST', '/api/auth/register', {
    body: {
      first_name: 'Smoke',
      last_name: 'Tester',
      email: volEmail,
      password: 'Password1',
      phone: '07700 900999',
    },
  });
  ok('Register volunteer', reg.status === 201, `${reg.status} ${reg.text}`);

  // 2. Volunteer login
  const volLogin = await req('POST', '/api/auth/login', {
    body: { email: volEmail, password: 'Password1' },
  });
  const volCookie = volLogin.cookie;
  ok('Volunteer login', volLogin.status === 200 && !!volCookie, `${volLogin.status}`);

  // 3. Admin login (seeded)
  const adminLogin = await req('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminCookie = adminLogin.cookie;
  if (!ok('Admin login (seeded)', adminLogin.status === 200 && !!adminCookie,
    `${adminLogin.status} — did you run "npm run db:reset"?`)) {
    return finish();
  }

  // 4. Volunteer creates a profile
  const profile = await req('POST', '/api/volunteer/profile', {
    cookie: volCookie,
    body: {
      availability: 'Weekends',
      address: '1 Test Street',
      emergency_contact: 'Next of Kin 07700 900000',
      skills: 'Automated testing',
      date_of_birth: '1990-01-01',
    },
  });
  ok('Create volunteer profile', profile.status === 201, `${profile.status} ${profile.text}`);

  // 5. Applying before approval must be blocked (business rule)
  //    First we need an opportunity — admin creates one.
  const opp = await req('POST', '/api/opportunities', {
    cookie: adminCookie,
    body: {
      title: `Smoke Test Shift ${stamp}`,
      description: 'Automated end-to-end test shift.',
      requirements: 'None',
      location: 'Test Kennels',
      start_date: futureDate(2, 9),
      end_date: futureDate(2, 12),
      max_volunteers: 5,
    },
  });
  const oppId = opp.json && (opp.json.id || opp.json.opportunity_id);
  ok('Admin create opportunity', opp.status === 201 && !!oppId, `${opp.status} ${opp.text}`);

  const earlyApply = await req('POST', '/api/applications', {
    cookie: volCookie,
    body: { opportunityId: oppId },
  });
  ok('Apply blocked until profile approved', earlyApply.status === 403, `expected 403, got ${earlyApply.status}`);

  // 6. Admin finds the volunteer and approves the profile
  const vols = await req('GET', '/api/admin/volunteers', { cookie: adminCookie });
  const me = Array.isArray(vols.json) ? vols.json.find((v) => v.email === volEmail) : null;
  ok('Admin volunteers list works (phone column)', vols.status === 200 && !!me,
    `${vols.status}${me ? '' : ' — volunteer not found in list'}`);
  if (me) {
    ok('Registered phone was stored', me.phone === '07700 900999', `got "${me.phone}"`);
  }

  const approve = me
    ? await req('PUT', `/api/admin/volunteers/${me.id}/approval`, {
        cookie: adminCookie,
        body: { approved: true },
      })
    : { status: 0 };
  ok('Admin approves volunteer profile', approve.status === 200, `${approve.status}`);

  // 7. Volunteer applies (now allowed)
  const apply = await req('POST', '/api/applications', {
    cookie: volCookie,
    body: { opportunityId: oppId },
  });
  ok('Apply after approval', apply.status === 201, `${apply.status} ${apply.text}`);

  // 8. Admin accepts the application
  const pendingApps = await req('GET', '/api/applications?status=pending', { cookie: adminCookie });
  const myApp = Array.isArray(pendingApps.json)
    ? pendingApps.json.find((a) => Number(a.opportunity_id) === Number(oppId) && a.email === volEmail)
    : null;
  ok('Admin sees pending application', pendingApps.status === 200 && !!myApp, `${pendingApps.status}`);

  const accept = myApp
    ? await req('PUT', `/api/applications/${myApp.id}`, {
        cookie: adminCookie,
        body: { status: 'accepted' },
      })
    : { status: 0 };
  ok('Admin accepts application', accept.status === 200, `${accept.status}`);

  // 9. Volunteer logs hours (requires an accepted application)
  const logHours = await req('POST', '/api/hours', {
    cookie: volCookie,
    body: { opportunityId: oppId, date: todayStr(), hours: 2 },
  });
  ok('Log hours (accepted application)', logHours.status === 201, `${logHours.status} ${logHours.text}`);

  // 10. Admin approves the logged hours
  const pendingHours = await req('GET', '/api/hours/pending', { cookie: adminCookie });
  const myHours = Array.isArray(pendingHours.json)
    ? pendingHours.json.find((h) => h.email === volEmail)
    : null;
  ok('Admin sees pending hours', pendingHours.status === 200 && !!myHours, `${pendingHours.status}`);

  const approveHours = myHours
    ? await req('PUT', `/api/hours/${myHours.id}/approve`, { cookie: adminCookie })
    : { status: 0 };
  ok('Admin approves hours', approveHours.status === 200, `${approveHours.status}`);

  // 11. Volunteer stats reflect the approved hours
  const stats = await req('GET', '/api/hours/stats', { cookie: volCookie });
  ok('Volunteer stats show approved hours', stats.status === 200 && Number(stats.json?.totalHours) >= 2,
    `${stats.status} total=${stats.json?.totalHours}`);

  // 12. Badges: one accepted shift earns "First Step"
  const badges = await req('GET', '/api/volunteer/badges', { cookie: volCookie });
  const earnedFirst = Array.isArray(badges.json?.earned) && badges.json.earned.some((b) => b.id === 'first_step');
  ok('First Step badge earned', badges.status === 200 && earnedFirst, `${badges.status}`);

  // 13. CSV export includes the new volunteer
  const csv = await req('GET', '/api/export/volunteers', { cookie: adminCookie });
  ok('Volunteer CSV export works', csv.status === 200 && csv.text.includes(volEmail),
    `${csv.status}`);

  // 14. Unauthenticated access is rejected
  const noAuth = await req('GET', '/api/admin/volunteers');
  ok('Admin route blocks unauthenticated', noAuth.status === 401, `expected 401, got ${noAuth.status}`);

  return finish();
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err.message);
  process.exit(1);
});
