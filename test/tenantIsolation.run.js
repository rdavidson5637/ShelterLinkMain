'use strict';

// Local Postgres only. This file refuses to use any other database.
// CI sets TENANT_DATABASE_URL to a localhost service container.
// Otherwise this file starts a temporary cluster with initdb from PATH or PG_BIN.
function assertLocalTestUrl(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    console.error('Refusing to run tenant isolation: database URL is not parseable.');
    process.exit(1);
  }
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error('Refusing to run tenant isolation against a non-local database.');
    process.exit(1);
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (dbName !== 'shelterlink_tenant_test') {
    console.error(`Refusing tenant test database name ${dbName}`);
    process.exit(1);
  }
  return parsed;
}

const SERVICE_URL = process.env.TENANT_DATABASE_URL || '';
const USE_SERVICE = Boolean(SERVICE_URL);
const LOCAL = USE_SERVICE
  ? SERVICE_URL
  : 'postgresql://postgres@127.0.0.1:54329/shelterlink_tenant_test';
assertLocalTestUrl(LOCAL);
process.env.DATABASE_URL = LOCAL;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'tenant-isolation-test-secret-value';
process.env.PORT = '0';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const DATA = '/tmp/shelterlink-tenant-pg';
const PG_PORT = '54329';
const DB_NAME = 'shelterlink_tenant_test';
const MARKER = 'MarkerA';
const A_EMAILS = ['a.admin@example.test', 'a.volunteer@example.test'];
const ICAL_A = 'b'.repeat(64);
const RESET_TOKEN = 'marker-a-reset-token';
const REFERENCE_TOKEN = 'marker-a-reference-token';

let pgBin = '';
let startedLocalCluster = false;

function resolvePgBin() {
  if (process.env.PG_BIN) {
    if (fs.existsSync(path.join(process.env.PG_BIN, 'initdb'))) return process.env.PG_BIN;
    throw new Error(`PG_BIN does not contain initdb: ${process.env.PG_BIN}`);
  }
  const found = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' });
  const initdb = (found.stdout || '').trim();
  if (!initdb) return '';
  return path.dirname(initdb);
}

function bin(name) {
  return path.join(pgBin, name);
}

function runPg(name, args, { allowFail = false } = {}) {
  const result = spawnSync(bin(name), args, { encoding: 'utf8' });
  if (!allowFail && result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${name} failed (${result.status}): ${detail}`);
  }
  return result;
}

function startCluster() {
  pgBin = resolvePgBin();
  if (!pgBin || !fs.existsSync(bin('initdb'))) {
    throw new Error('Postgres initdb was not found on PATH. Install Postgres client tools, set PG_BIN, or set TENANT_DATABASE_URL to a local Postgres service.');
  }
  runPg('pg_ctl', ['-D', DATA, 'stop', '-m', 'immediate', '-w'], { allowFail: true });
  fs.rmSync(DATA, { recursive: true, force: true });
  runPg('initdb', [
    '-D', DATA,
    '-U', 'postgres',
    '--auth-local=trust',
    '--auth-host=trust',
    '--no-instructions',
  ]);
  runPg('pg_ctl', [
    '-D', DATA,
    '-l', path.join(DATA, 'server.log'),
    '-w',
    '-o', `-p ${PG_PORT} -k /tmp -c listen_addresses=127.0.0.1`,
    'start',
  ]);
  runPg('createdb', ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', DB_NAME]);
  startedLocalCluster = true;
}

function stopCluster() {
  if (!startedLocalCluster) return;
  runPg('pg_ctl', ['-D', DATA, 'stop', '-m', 'immediate', '-w'], { allowFail: true });
  fs.rmSync(DATA, { recursive: true, force: true });
  startedLocalCluster = false;
}

function maintenanceUrl() {
  const url = new URL(LOCAL);
  url.pathname = '/postgres';
  return url.toString();
}

async function withMaintenance(fn) {
  const client = new Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function resetServiceDatabase() {
  await withMaintenance(async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = 'shelterlink_tenant_test' AND pid <> pg_backend_pid()`
    );
    await client.query('DROP DATABASE IF EXISTS shelterlink_tenant_test');
    await client.query('DROP ROLE IF EXISTS shelterlink_tenant');
    await client.query('CREATE DATABASE shelterlink_tenant_test');
  });
}

async function dropServiceDatabase() {
  await withMaintenance(async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = 'shelterlink_tenant_test' AND pid <> pg_backend_pid()`
    );
    await client.query('DROP DATABASE IF EXISTS shelterlink_tenant_test');
    await client.query('DROP ROLE IF EXISTS shelterlink_tenant');
  });
}

async function applySchema(admin) {
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema.pg.sql'), 'utf8');
  const tenancy = fs.readFileSync(path.join(ROOT, 'database', '033_add_shelters.pg.sql'), 'utf8');
  await admin.query(schema);
  const { applySql } = require('../scripts/applySql');
  await applySql(admin, tenancy);
}

async function seed(admin) {
  const passwordHash = bcrypt.hashSync('Password1', 4);
  const resetHash = crypto.createHash('sha256').update(RESET_TOKEN).digest('hex');
  const referenceHash = crypto.createHash('sha256').update(REFERENCE_TOKEN).digest('hex');

  await admin.query(
    `INSERT INTO shelters (id, name, slug) VALUES (2, 'Second Shelter', 'second')`
  );
  await admin.query(
    `INSERT INTO users (
       user_id, first_name, last_name, name, email, password, role, shelter_id, ical_token, reset_token, reset_token_expires
     ) VALUES
     (1, 'Ada', 'MarkerA', 'Ada MarkerA', 'a.admin@example.test', $1, 'admin', 1, $3, NULL, NULL),
     (2, 'Ann', 'MarkerA', 'Ann MarkerA', 'a.volunteer@example.test', $1, 'volunteer', 1, $4, $2, '2099-12-01'),
     (3, 'Bea', 'Other', 'Bea Other', 'b.admin@example.test', $1, 'admin', 2, NULL, NULL, NULL),
     (4, 'Ben', 'Other', 'Ben Other', 'b.volunteer@example.test', $1, 'volunteer', 2, NULL, NULL, NULL)`,
    [passwordHash, resetHash, 'a'.repeat(64), ICAL_A]
  );
  await admin.query(`
    INSERT INTO volunteer_profiles (user_id, address, approved, shelter_id) VALUES
      (1, '1 MarkerA lane', 1, 1),
      (2, '1 MarkerA lane', 1, 1),
      (3, 'home', 1, 2),
      (4, 'home', 1, 2);
    INSERT INTO opportunities (
      opportunity_id, title, description, location, start_date, end_date, max_volunteers,
      status, created_by, check_in_code, shelter_id
    ) VALUES (
      1, 'MarkerA shift', 'MarkerA', 'Yard', '2099-06-01 10:00:00', '2099-06-01 12:00:00', 4,
      'open', 1, 'ABC123', 1
    );
    INSERT INTO applications (
      application_id, user_id, opportunity_id, status, notes, shelter_id
    ) VALUES (1, 2, 1, 'accepted', 'MarkerA', 1);
    INSERT INTO shift_feedback (id, application_id, rating, comment, shelter_id)
      VALUES (1, 1, 3, 'MarkerA', 1);
    INSERT INTO swap_requests (id, application_id, status, claim_token, waitlist_offered_to_user_id, shelter_id)
      VALUES (1, 1, 'open', 'marker-a-claim-token', 2, 1);
    INSERT INTO volunteer_hours (record_id, user_id, opportunity_id, date, hours, approved, shelter_id)
      VALUES (1, 2, 1, '2099-06-01', 2, 0, 1);
    INSERT INTO qualifications (id, name, description, shelter_id)
      VALUES (1, 'MarkerA handling', 'MarkerA', 1);
    INSERT INTO volunteer_qualifications (id, user_id, qualification_id, awarded_at, shelter_id)
      VALUES (1, 2, 1, '2099-01-01', 1);
    INSERT INTO opportunity_qualifications (opportunity_id, qualification_id, shelter_id)
      VALUES (1, 1, 1);
    INSERT INTO tags (id, name, shelter_id) VALUES (100, 'MarkerA', 1);
    INSERT INTO volunteer_tags (user_id, tag_id, shelter_id) VALUES (2, 100, 1);
    INSERT INTO opportunity_tags (opportunity_id, tag_id, shelter_id) VALUES (1, 100, 1);
    INSERT INTO opportunity_match_queue (id, opportunity_id, user_id, shelter_id)
      VALUES (1, 1, 2, 1);
    INSERT INTO tag_digest_log (user_id, digest_date, shelter_id) VALUES (2, '2099-06-01', 1);
    INSERT INTO custom_fields (id, label, shelter_id) VALUES (1, 'MarkerA field', 1);
    INSERT INTO custom_field_values (id, field_id, user_id, value, shelter_id)
      VALUES (1, 1, 2, 'MarkerA', 1);
    INSERT INTO waivers (id, title, body, shelter_id) VALUES (1, 'MarkerA waiver', 'MarkerA', 1);
    INSERT INTO waiver_acceptances (id, waiver_id, user_id, version, shelter_id)
      VALUES (1, 1, 2, 1, 1);
    INSERT INTO user_documents (
      id, user_id, filename, original_name, mime_type, size, label, shelter_id
    ) VALUES (1, 2, 'MarkerA.pdf', 'MarkerA.pdf', 'application/pdf', 4, 'MarkerA', 1);
    INSERT INTO admin_messages (id, admin_id, subject, body, shelter_id)
      VALUES (1, 1, 'MarkerA', 'MarkerA', 1);
    INSERT INTO audit_log (id, user_id, action, entity_type, detail_json, shelter_id)
      VALUES (1, 1, 'MarkerA.touch', 'users', '{"note":"MarkerA"}', 1);
    INSERT INTO group_bookings (
      id, opportunity_id, group_name, contact_name, contact_email, size, notes, shelter_id
    ) VALUES (1, 1, 'MarkerA group', 'MarkerA', 'group@example.test', 2, 'MarkerA', 1);
    INSERT INTO animals (id, name, notes, shelter_id) VALUES (1, 'MarkerA dog', 'MarkerA', 1);
    INSERT INTO opportunity_animals (opportunity_id, animal_id, shelter_id) VALUES (1, 1, 1);
    INSERT INTO animal_activity (id, animal_id, user_id, application_id, activity_type, notes, shelter_id)
      VALUES (1, 1, 2, 1, 'walk', 'MarkerA', 1);
    INSERT INTO animal_photos (animal_id, content, mime_type, shelter_id)
      VALUES (1, decode('ffd8', 'hex'), 'image/jpeg', 1);
    INSERT INTO foster_requests (
      id, animal_id, created_by, needed_from, description, status, shelter_id
    ) VALUES (1, 1, 1, '2099-06-01', 'MarkerA', 'open', 1);
    INSERT INTO foster_offers (id, request_id, user_id, note, shelter_id)
      VALUES (1, 1, 2, 'MarkerA', 1);
    INSERT INTO foster_placements (
      id, animal_id, user_id, request_id, started_on, status, notes, shelter_id
    ) VALUES (1, 1, 2, 1, '2099-06-01', 'active', 'MarkerA', 1);
    INSERT INTO transport_runs (id, animal_id, title, run_date, created_by, shelter_id)
      VALUES (1, 1, 'MarkerA run', '2099-06-01', 1, 1);
    INSERT INTO transport_legs (
      id, run_id, leg_order, from_location, to_location, shelter_id
    ) VALUES (1, 1, 1, 'MarkerA', 'Yard', 1);
    INSERT INTO incidents (id, animal_id, opportunity_id, reported_by, body, shelter_id)
      VALUES (1, 1, 1, 1, 'MarkerA', 1);
    INSERT INTO message_threads (id, subject, context_type, context_id, created_by, shelter_id)
      VALUES (1, 'MarkerA thread', 'direct', NULL, 1, 1);
    INSERT INTO thread_participants (thread_id, user_id, shelter_id) VALUES (1, 1, 1);
    INSERT INTO messages (id, thread_id, user_id, body, shelter_id)
      VALUES (1, 1, 1, 'MarkerA', 1);
    INSERT INTO message_digest_log (user_id, digest_hour, shelter_id)
      VALUES (1, '2099-06-01 10:00:00', 1);
    INSERT INTO shift_notes (id, opportunity_id, author_id, body, shelter_id)
      VALUES (1, 1, 1, 'MarkerA', 1);
    INSERT INTO certificates (id, user_id, code, shelter_id)
      VALUES (1, 2, 'MARKERACODE1', 1);
    INSERT INTO volunteer_references (
      id, user_id, referee_name, referee_email, token_hash, expires_at, shelter_id
    ) VALUES (
      1, 2, 'MarkerA', 'ref@example.test', '${referenceHash}', '2099-12-01', 1
    );
    INSERT INTO background_checks (id, user_id, status, notes, shelter_id)
      VALUES (1, 2, 'pending', 'MarkerA', 1);
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, shelter_id)
      VALUES (1, 2, 'https://push.example.test/MarkerA', 'key', 'auth', 1);
    INSERT INTO opportunity_templates (id, name, payload_json, created_by, shelter_id)
      VALUES (1, 'MarkerA template', '{}', 1, 1);
  `);

  const sequences = [
    ['shelters', 'id'],
    ['users', 'user_id'],
    ['volunteer_profiles', 'profile_id'],
    ['opportunities', 'opportunity_id'],
    ['applications', 'application_id'],
    ['shift_feedback', 'id'],
    ['swap_requests', 'id'],
    ['volunteer_hours', 'record_id'],
    ['qualifications', 'id'],
    ['volunteer_qualifications', 'id'],
    ['tags', 'id'],
    ['opportunity_match_queue', 'id'],
    ['custom_fields', 'id'],
    ['custom_field_values', 'id'],
    ['waivers', 'id'],
    ['waiver_acceptances', 'id'],
    ['user_documents', 'id'],
    ['admin_messages', 'id'],
    ['audit_log', 'id'],
    ['group_bookings', 'id'],
    ['animals', 'id'],
    ['animal_activity', 'id'],
    ['foster_requests', 'id'],
    ['foster_offers', 'id'],
    ['foster_placements', 'id'],
    ['transport_runs', 'id'],
    ['transport_legs', 'id'],
    ['incidents', 'id'],
    ['message_threads', 'id'],
    ['messages', 'id'],
    ['shift_notes', 'id'],
    ['certificates', 'id'],
    ['volunteer_references', 'id'],
    ['background_checks', 'id'],
    ['push_subscriptions', 'id'],
    ['opportunity_templates', 'id'],
  ];
  for (const [table, column] of sequences) {
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) {
      throw new Error(`Bad sequence name ${table}.${column}`);
    }
    await admin.query(
      `SELECT setval(pg_get_serial_sequence('${table}', '${column}'), (SELECT MAX(${column}) FROM ${table}))`
    );
  }
}

async function countsForShelter(admin) {
  const { TENANT_TABLES } = require('../utils/shelterContext');
  const counts = {};
  for (const table of TENANT_TABLES) {
    if (table === 'shelters' || !/^[a-z_]+$/.test(table)) continue;
    const result = await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE shelter_id = 1`);
    counts[table] = result.rows[0].n;
  }
  return counts;
}

async function snapshot(admin) {
  const result = await admin.query(`
    SELECT
      (SELECT name FROM animals WHERE id = 1) AS animal_name,
      (SELECT status FROM applications WHERE application_id = 1) AS app_status,
      (SELECT checked_in_at IS NULL FROM applications WHERE application_id = 1) AS not_checked_in,
      (SELECT approved FROM volunteer_hours WHERE record_id = 1) AS hours_approved,
      (SELECT password FROM users WHERE user_id = 2) AS volunteer_password,
      (SELECT reset_token FROM users WHERE user_id = 2) AS reset_token,
      (SELECT last_name FROM users WHERE user_id = 2) AS last_name,
      (SELECT status FROM foster_placements WHERE id = 1) AS placement_status,
      (SELECT ended_on IS NULL FROM foster_placements WHERE id = 1) AS placement_open,
      (SELECT body FROM incidents WHERE id = 1) AS incident_body,
      (SELECT status FROM volunteer_references WHERE id = 1) AS reference_status,
      (SELECT count(*)::int FROM users WHERE shelter_id = 1) AS user_count
  `);
  return result.rows[0];
}

async function assertRls(admin) {
  await admin.query('BEGIN');
  try {
    await admin.query(`SELECT set_config('app.shelter_id', '2', true)`);
    await admin.query('SET LOCAL ROLE shelterlink_tenant');
    const animals = await admin.query('SELECT count(*)::int AS n FROM animals');
    const users = await admin.query('SELECT count(*)::int AS n FROM users');
    if (animals.rows[0].n !== 0) {
      throw new Error(`RLS let shelter 2 see ${animals.rows[0].n} animals`);
    }
    if (users.rows[0].n !== 2) {
      throw new Error(`RLS user count for shelter 2 was ${users.rows[0].n}, expected 2`);
    }
  } finally {
    await admin.query('ROLLBACK');
  }
}

function request(port, method, urlPath, { json, raw, type, cookie } = {}) {
  const payload = raw || (json == null ? null : Buffer.from(JSON.stringify(json)));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        ...(payload ? {
          'content-type': type || 'application/json',
          'content-length': payload.length,
        } : {}),
        ...(cookie ? { cookie } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
          setCookie: res.headers['set-cookie'] || [],
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionCookie(setCookie) {
  let cookie = '';
  for (const line of setCookie) {
    const pair = String(line).split(';')[0];
    if (pair.startsWith('connect.sid=')) cookie = pair;
  }
  return cookie;
}

function leaks(text) {
  if (text.includes(MARKER)) return MARKER;
  for (const email of A_EMAILS) {
    if (text.includes(email)) return email;
  }
  return '';
}

function cases(feedbackToken) {
  const deny = (method, urlPath, json) => ({ method, urlPath, json, expect: 'deny' });
  const own = (method, urlPath, json) => ({ method, urlPath, json, expect: 'own' });
  const list = [
    own('GET', '/api/auth/me'),
    own('GET', '/api/volunteer/profile'),
    own('GET', '/api/volunteer/badges'),
    own('GET', '/api/opportunities'),
    own('GET', '/api/applications'),
    own('GET', '/api/applications/my-applications'),
    own('GET', '/api/hours/my-hours'),
    own('GET', '/api/hours/pending'),
    own('GET', '/api/admin/day-sheet?date=2099-06-01'),
    own('GET', '/api/admin/week-sheet'),
    own('GET', '/api/admin/week-sheet.ics'),
    own('GET', '/api/admin/stats'),
    own('GET', '/api/admin/stats/leaderboard'),
    own('GET', '/api/admin/volunteers'),
    own('GET', '/api/admin/messages'),
    own('GET', '/api/admin/audit-log'),
    own('GET', '/api/export/volunteers'),
    own('GET', '/api/export/hours'),
    own('GET', '/api/export/community-service'),
    own('GET', '/api/public/opportunities'),
    own('GET', '/api/public/opportunities.ics'),
    own('GET', '/api/stats/me'),
    own('GET', '/api/stats/leaderboard'),
    own('GET', '/api/qualifications'),
    own('GET', '/api/custom-fields'),
    own('GET', '/api/waivers'),
    own('GET', '/api/documents/mine'),
    own('GET', '/api/tags'),
    own('GET', '/api/feedback/admin'),
    own('GET', '/api/feedback/my-past-shifts'),
    own('GET', '/api/group-bookings'),
    own('GET', '/api/animals'),
    own('GET', '/api/animals/me/helped'),
    own('GET', '/api/fosters/requests'),
    own('GET', '/api/fosters/placements'),
    own('GET', '/api/fosters/my-placements'),
    own('GET', '/api/transport'),
    own('GET', '/api/transport/legs/open'),
    own('GET', '/api/incidents'),
    own('GET', '/api/threads'),
    own('GET', '/api/threads/unread-count'),
    own('GET', '/api/vetting/admin/pipeline'),
    own('GET', '/api/vetting/admin/expiring'),
    own('GET', '/api/vetting/me/references'),
    own('GET', '/api/opportunity-templates'),
    own('GET', '/api/push/prefs'),
    own('GET', '/api/me/ical-feed'),

    deny('GET', '/api/opportunities/1'),
    deny('PUT', '/api/opportunities/1', { title: 'Changed', status: 'closed' }),
    deny('DELETE', '/api/opportunities/1'),
    deny('POST', '/api/opportunities/1/clone'),
    deny('POST', '/api/opportunities/1/urgent'),
    deny('GET', '/api/opportunities/1/notes'),
    deny('POST', '/api/opportunities/1/notes', { body: 'note' }),
    deny('DELETE', '/api/opportunities/1/notes/1'),
    deny('GET', '/api/applications/1/ics'),
    deny('PUT', '/api/applications/1', { status: 'rejected' }),
    deny('PATCH', '/api/applications/1/no-show'),
    deny('POST', '/api/applications/1/check-in', { code: 'ABC123' }),
    deny('POST', '/api/applications/1/check-out', { code: 'ABC123' }),
    deny('DELETE', '/api/applications/1'),
    deny('POST', '/api/applications/1/swap'),
    deny('POST', '/api/applications/swaps/1/claim'),
    deny('DELETE', '/api/applications/swaps/1'),
    deny('POST', '/api/applications/swaps/claim-by-token', { token: 'marker-a-claim-token' }),
    deny('POST', '/api/applications', { opportunityId: 1 }),
    deny('PUT', '/api/hours/1/approve'),
    deny('POST', '/api/hours', { opportunityId: 1, date: '2020-01-01', hours: 1 }),
    deny('GET', '/api/admin/volunteers/2'),
    deny('PUT', '/api/admin/volunteers/2/approval', { approved: false }),
    deny('PUT', '/api/admin/volunteers/2/foster-approval', { foster_approved: false }),
    deny('PUT', '/api/admin/volunteers/2/service-settings', { volunteer_type: 'regular' }),
    deny('GET', '/api/admin/volunteers/2/qualifications'),
    deny('POST', '/api/admin/volunteers/2/qualifications', { qualification_id: 1 }),
    deny('DELETE', '/api/admin/volunteers/2/qualifications/1'),
    deny('GET', '/api/admin/volunteers/2/custom-fields'),
    deny('GET', '/api/admin/volunteers/2/waivers'),
    deny('GET', '/api/admin/volunteers/2/documents'),
    deny('GET', '/api/admin/gdpr/volunteers/2/export'),
    deny('POST', '/api/admin/gdpr/volunteers/2/erase', { confirmation: 'DELETE' }),
    deny('PUT', '/api/admin/users/2/role', { role: 'staff' }),
    deny('GET', '/api/qualifications/1'),
    deny('PUT', '/api/qualifications/1', { name: 'Changed' }),
    deny('DELETE', '/api/qualifications/1'),
    deny('PUT', '/api/custom-fields/1', { label: 'Changed' }),
    deny('DELETE', '/api/custom-fields/1'),
    deny('PUT', '/api/waivers/1', { title: 'Changed', body: 'Changed' }),
    deny('GET', '/api/documents/1/download'),
    deny('PUT', '/api/documents/1', { label: 'Changed' }),
    deny('DELETE', '/api/documents/1'),
    deny('GET', `/api/feedback?token=${encodeURIComponent(feedbackToken)}`),
    deny('POST', '/api/feedback', { token: feedbackToken, rating: 5, comment: 'no' }),
    deny('PATCH', '/api/feedback/admin/1/handled'),
    deny('GET', '/api/feedback/link/1'),
    deny('POST', '/api/group-bookings', {
      opportunity_id: 1,
      group_name: 'Other',
      contact_name: 'Pat',
      contact_email: 'pat@example.test',
      size: 1,
    }),
    deny('POST', '/api/group-bookings/1/confirm'),
    deny('POST', '/api/group-bookings/1/decline'),
    deny('GET', '/api/animals/1'),
    deny('PUT', '/api/animals/1', { name: 'Changed' }),
    deny('GET', '/api/animals/1/photo'),
    deny('POST', '/api/animals/1/activity', { application_id: 1, activity_type: 'walk' }),
    deny('GET', '/api/fosters/requests/1'),
    deny('PUT', '/api/fosters/requests/1', { description: 'Changed' }),
    deny('POST', '/api/fosters/requests/1/cancel'),
    deny('GET', '/api/fosters/requests/1/offers'),
    deny('POST', '/api/fosters/requests/1/offers', { note: 'no' }),
    deny('POST', '/api/fosters/offers/1/confirm'),
    deny('POST', '/api/fosters/placements/1/end'),
    deny('POST', '/api/fosters/placements/1/check-in', { note: 'no' }),
    deny('POST', '/api/fosters/requests', {
      animal_id: 1,
      needed_from: '2099-07-01',
      description: 'no',
    }),
    deny('GET', '/api/transport/1'),
    deny('PUT', '/api/transport/1/status', { status: 'cancelled' }),
    deny('POST', '/api/transport/1/chase'),
    deny('POST', '/api/transport/legs/1/claim'),
    deny('POST', '/api/transport/legs/1/complete'),
    deny('GET', '/api/incidents/1'),
    deny('PUT', '/api/incidents/1', { body: 'Changed' }),
    deny('POST', '/api/incidents/1/resolve'),
    deny('DELETE', '/api/incidents/1'),
    deny('POST', '/api/incidents', { animal_id: 1, opportunity_id: 1, body: 'no', severity: 'info' }),
    deny('GET', '/api/threads/1'),
    deny('POST', '/api/threads/1/messages', { body: 'no' }),
    deny('DELETE', '/api/threads/1/messages/1'),
    deny('POST', '/api/threads/1/read'),
    deny('POST', '/api/threads', {
      context_type: 'opportunity',
      context_id: 1,
      body: 'no',
    }),
    deny('POST', '/api/threads', {
      context_type: 'foster_placement',
      context_id: 1,
      body: 'no',
    }),
    deny('POST', '/api/threads', {
      context_type: 'transport_run',
      context_id: 1,
      body: 'no',
    }),
    deny('GET', '/api/vetting/volunteers/2/references'),
    deny('POST', '/api/vetting/volunteers/2/references', {
      referee_name: 'Other',
      referee_email: 'other@example.test',
    }),
    deny('GET', '/api/vetting/volunteers/2/background-checks'),
    deny('PUT', '/api/vetting/volunteers/2/background-checks/1', {
      check_type: 'accessni_basic',
      status: 'clear',
    }),
    deny('GET', `/api/public/references/${encodeURIComponent(REFERENCE_TOKEN)}`),
    deny('POST', `/api/public/references/${encodeURIComponent(REFERENCE_TOKEN)}`, {
      is_suitable: true,
      comments: 'no',
    }),
    deny('GET', '/api/public/verify-certificate/MARKERACODE1'),
    deny('GET', `/api/my-shifts.ics?token=${ICAL_A}`),
    deny('GET', '/api/opportunity-templates/1'),
    deny('DELETE', '/api/opportunity-templates/1'),
    { method: 'GET', urlPath: '/api/animals?shelter_id=1', expect: 'rejected' },
    { method: 'POST', urlPath: '/api/animals', json: { name: 'Dog', shelter_id: 1 }, expect: 'rejected' },
    { method: 'POST', urlPath: '/api/auth/forgot-password', json: { email: 'a.volunteer@example.test' }, expect: 'forgot' },
    {
      method: 'POST',
      urlPath: '/api/auth/reset-password',
      json: { token: RESET_TOKEN, password: 'Password2' },
      expect: 'reset',
    },
  ];
  return list;
}

async function main() {
  let admin;
  let httpServer;
  let closePool;
  try {
    if (USE_SERVICE) await resetServiceDatabase();
    else startCluster();
    admin = new Client({ connectionString: LOCAL });
    await admin.connect();
    await applySchema(admin);
    await seed(admin);
    await assertRls(admin);

    await admin.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        PRIMARY KEY ("sid")
      )
    `);
    await admin.query('CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")');
    await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session TO shelterlink_tenant');
    await admin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shelterlink_tenant');

    const started = require('../server');
    closePool = require('../config/database').closePool;

    httpServer = await new Promise((resolve) => {
      const server = started.app.listen(0, '127.0.0.1', () => resolve(server));
    });
    const port = httpServer.address().port;
    const { createFeedbackToken } = require('../utils/feedbackToken');
    const feedbackToken = createFeedbackToken(1);

    const login = await request(port, 'POST', '/api/auth/login', {
      json: { email: 'b.admin@example.test', password: 'Password1' },
    });
    if (login.status !== 200) {
      throw new Error(`Shelter B login failed ${login.status}: ${login.text}`);
    }
    const cookie = sessionCookie(login.setCookie);
    if (!cookie) throw new Error('Login did not set a session cookie');
    if (leaks(login.text)) throw new Error(`Login response leaked ${leaks(login.text)}`);

    const beforeCounts = await countsForShelter(admin);
    const beforeRow = await snapshot(admin);
    const failures = [];

    for (const item of cases(feedbackToken)) {
      const response = await request(port, item.method, item.urlPath, { json: item.json, cookie });
      const leak = leaks(response.text);
      let ok = false;
      if (item.expect === 'deny') ok = response.status === 403 || response.status === 404;
      else if (item.expect === 'own') ok = response.status === 200;
      else if (item.expect === 'rejected') ok = response.status === 400 && response.text.includes('shelter_id is not accepted');
      else if (item.expect === 'forgot') ok = response.status === 200;
      else if (item.expect === 'reset') ok = response.status === 400;
      if (!ok || leak) {
        failures.push(`${item.method} ${item.urlPath} -> ${response.status} ${leak ? `leaked ${leak}` : response.text.slice(0, 180)}`);
      }
      if (item.urlPath === '/api/admin/stats' && response.status === 200) {
        const stats = JSON.parse(response.text);
        if (Number(stats.totalVolunteers) !== 1 || Number(stats.activeOpportunities) !== 0 || Number(stats.totalApprovedVolunteers) !== 2) {
          failures.push(`stats leaked other shelter counts ${response.text}`);
        }
      }
    }

    const photo = Buffer.concat([
      Buffer.from('------ShelterLinkTenant\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      Buffer.from('\r\n------ShelterLinkTenant--\r\n'),
    ]);
    const uploaded = await request(port, 'POST', '/api/animals/1/photo', {
      raw: photo,
      type: 'multipart/form-data; boundary=----ShelterLinkTenant',
      cookie,
    });
    if (![403, 404].includes(uploaded.status) || leaks(uploaded.text)) {
      failures.push(`POST /api/animals/1/photo -> ${uploaded.status} ${uploaded.text.slice(0, 180)}`);
    }

    const kioskLogin = await request(port, 'POST', '/api/kiosk/unlock', {
      json: { email: 'b.admin@example.test', password: 'Password1' },
    });
    const kioskCookie = sessionCookie(kioskLogin.setCookie);
    if (kioskLogin.status !== 200 || !kioskCookie) {
      failures.push(`kiosk unlock -> ${kioskLogin.status} ${kioskLogin.text.slice(0, 180)}`);
    } else {
      const today = await request(port, 'GET', '/api/kiosk/shifts/today', { cookie: kioskCookie });
      const checkIn = await request(port, 'POST', '/api/kiosk/applications/1/check-in', {
        json: { code: 'ABC123' },
        cookie: kioskCookie,
      });
      const checkOut = await request(port, 'POST', '/api/kiosk/applications/1/check-out', {
        json: { code: 'ABC123' },
        cookie: kioskCookie,
      });
      if (today.status !== 200 || leaks(today.text)) {
        failures.push(`kiosk today -> ${today.status} ${today.text.slice(0, 180)}`);
      }
      for (const [label, response] of [['check-in', checkIn], ['check-out', checkOut]]) {
        if (![403, 404].includes(response.status) || leaks(response.text)) {
          failures.push(`kiosk ${label} -> ${response.status} ${response.text.slice(0, 180)}`);
        }
      }
    }

    const brandB = await request(port, 'GET', '/api/public/brand', { cookie });
    const brandPublic = await request(port, 'GET', '/api/public/brand');
    if (brandB.status !== 200 || !brandB.text.includes('Second Shelter') || leaks(brandB.text)) {
      failures.push(`logged-in brand -> ${brandB.status} ${brandB.text.slice(0, 180)}`);
    }
    if (brandPublic.status !== 200 || !brandPublic.text.includes('Assisi Animal Sanctuary') || leaks(brandPublic.text)) {
      failures.push(`public brand -> ${brandPublic.status} ${brandPublic.text.slice(0, 180)}`);
    }

    const { createShelterWithAdmin } = require('../services/shelterProvision');
    const logo = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const created = await createShelterWithAdmin({
      name: 'North Shelter',
      slug: 'north',
      adminName: 'Cora North',
      adminEmail: 'c.admin@example.test',
      adminPassword: 'Password1',
      logo,
      logoMime: 'image/png',
    });
    if (created.shelterId < 3) failures.push(`create shelter returned id ${created.shelterId}`);
    const northLogin = await request(port, 'POST', '/api/auth/login', {
      json: { email: 'c.admin@example.test', password: 'Password1' },
    });
    const northCookie = sessionCookie(northLogin.setCookie);
    if (northLogin.status !== 200 || !northCookie) {
      failures.push(`north login -> ${northLogin.status} ${northLogin.text.slice(0, 180)}`);
    } else {
      const northBrand = await request(port, 'GET', '/api/public/brand', { cookie: northCookie });
      const northLogo = await request(port, 'GET', '/api/public/brand/logo', { cookie: northCookie });
      const northAnimal = await request(port, 'GET', '/api/animals/1', { cookie: northCookie });
      if (northBrand.status !== 200 || !northBrand.text.includes('North Shelter') || leaks(northBrand.text) || northBrand.text.includes('Assisi')) {
        failures.push(`north brand -> ${northBrand.status} ${northBrand.text.slice(0, 180)}`);
      }
      if (northLogo.status !== 200 || !northLogo.text.includes('PNG')) {
        failures.push(`north logo -> ${northLogo.status}`);
      }
      if (![403, 404].includes(northAnimal.status) || leaks(northAnimal.text)) {
        failures.push(`north animal -> ${northAnimal.status} ${northAnimal.text.slice(0, 180)}`);
      }
    }

    const afterCounts = await countsForShelter(admin);
    const afterRow = await snapshot(admin);
    if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
      failures.push(`shelter A row counts changed ${JSON.stringify(beforeCounts)} -> ${JSON.stringify(afterCounts)}`);
    }
    const same = ['animal_name', 'app_status', 'not_checked_in', 'hours_approved', 'volunteer_password', 'reset_token', 'last_name', 'placement_status', 'placement_open', 'incident_body', 'reference_status', 'user_count'];
    for (const key of same) {
      if (String(beforeRow[key]) !== String(afterRow[key])) {
        failures.push(`shelter A ${key} changed from ${beforeRow[key]} to ${afterRow[key]}`);
      }
    }
    if (afterRow.animal_name !== 'MarkerA dog' || afterRow.last_name !== 'MarkerA' || afterRow.user_count !== 2) {
      failures.push(`shelter A snapshot was not the fixture: ${JSON.stringify(afterRow)}`);
    }

    if (failures.length) {
      console.error(`Tenant isolation failed (${failures.length}):`);
      failures.slice(0, 40).forEach((line) => console.error(`  ${line}`));
      if (failures.length > 40) console.error(`  ... ${failures.length - 40} more`);
      process.exitCode = 1;
    } else {
      console.log(`Tenant isolation passed (${cases(feedbackToken).length + 3} requests). Shelter A rows were unchanged.`);
    }
  } finally {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
    if (closePool) {
      try { await closePool(); } catch (error) { console.error(error.message); }
    }
    if (admin) {
      try { await admin.end(); } catch { /* already closed */ }
    }
    if (USE_SERVICE) {
      try { await dropServiceDatabase(); } catch (error) { console.error(error.message); }
    }
    stopCluster();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
  stopCluster();
}).finally(() => {
  process.exit(process.exitCode || 0);
});
