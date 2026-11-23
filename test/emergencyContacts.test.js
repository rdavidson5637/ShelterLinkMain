'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'database');
const {
  composeEmergencyContact,
  ALLOWED_PROFILE_FIELDS,
} = require('../models/VolunteerProfile');
const { bodies } = require('../validation/bodies');

test('migration 059 adds structured emergency contact columns additively', () => {
  const files = fs
    .readdirSync(DB)
    .filter((f) => /^\d{3}_.+\.pg\.sql$/.test(f))
    .sort();
  assert.ok(files.includes('059_emergency_contact_fields.pg.sql'));
  assert.ok(files.includes('058_shelter_closures.pg.sql'));
  assert.ok(files.includes('060_session_user_index.pg.sql'));

  const sql = fs.readFileSync(path.join(DB, '059_emergency_contact_fields.pg.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS emergency_contact_name/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS emergency_contact_relationship/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS emergency_contact_phone/);
  const executable = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executable, /DROP COLUMN/i);
  assert.doesNotMatch(executable, /DROP TABLE/i);

  const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
  assert.match(schema, /emergency_contact_name\s+VARCHAR\(120\)/);
  assert.match(schema, /emergency_contact_relationship\s+VARCHAR\(80\)/);
  assert.match(schema, /emergency_contact_phone\s+VARCHAR\(40\)/);
  assert.match(schema, /emergency_contact\s+VARCHAR\(255\)/);
});

test('composeEmergencyContact builds the legacy free-text line', () => {
  assert.equal(
    composeEmergencyContact({
      emergency_contact_name: 'Pat Rivers',
      emergency_contact_relationship: 'parent',
      emergency_contact_phone: '07700 900111',
    }),
    'Pat Rivers (parent) 07700 900111'
  );
  assert.equal(
    composeEmergencyContact({
      emergency_contact_name: 'Pat',
      emergency_contact_relationship: '',
      emergency_contact_phone: '07700',
    }),
    'Pat 07700'
  );
  assert.equal(composeEmergencyContact({}), null);
});

test('VolunteerProfile allows the structured emergency fields', () => {
  for (const key of [
    'emergency_contact_name',
    'emergency_contact_relationship',
    'emergency_contact_phone',
  ]) {
    assert.ok(ALLOWED_PROFILE_FIELDS.has(key), key);
  }
});

test('profile and staff emergency-contact bodies accept the new fields', () => {
  const profile = bodies.profile.parse({
    emergency_contact_name: 'Kim',
    emergency_contact_relationship: 'partner',
    emergency_contact_phone: '07700900222',
  });
  assert.equal(profile.emergency_contact_name, 'Kim');

  const staff = bodies.emergencyContact.parse({
    emergency_contact_name: 'Kim',
    emergency_contact_relationship: 'partner',
    emergency_contact_phone: '07700900222',
  });
  assert.equal(staff.emergency_contact_phone, '07700900222');
});

test('volunteer self-serve profile form collects name, relationship and phone', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'frontend/pages/volunteer/complete-profile.html'),
    'utf8'
  );
  assert.match(html, /id="emergency_contact_name"/);
  assert.match(html, /id="emergency_contact_relationship"/);
  assert.match(html, /id="emergency_contact_phone"/);
  assert.match(html, /id="saveEmergencyContactButton"/);
  assert.doesNotMatch(html, /id="emergency_contact"/);

  const js = fs.readFileSync(
    path.join(ROOT, 'frontend/js/volunteer/complete-profile.js'),
    'utf8'
  );
  assert.match(js, /emergency_contact_name/);
  assert.match(js, /saveEmergencyContact/);
  assert.match(js, /#emergencyContactSection/);
});

test('staff directory and detail show and edit emergency contacts', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'frontend/pages/admin/volunteers.html'),
    'utf8'
  );
  assert.match(html, /Emergency contact/);
  assert.match(html, /colspan="10"/);

  const js = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/volunteers.js'), 'utf8');
  assert.match(js, /formatEmergencyContact/);
  assert.match(js, /emergencyContactForm/);
  assert.match(js, /\/admin\/volunteers\/\$\{userId\}\/emergency-contact/);
  assert.match(js, /emergency_contact_name/);
});

test('admin route registers staff emergency-contact update', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
  assert.match(routes, /\/volunteers\/:userId\/emergency-contact/);
  assert.match(routes, /updateVolunteerEmergencyContact/);

  const controller = fs.readFileSync(
    path.join(ROOT, 'controllers/profileController.js'),
    'utf8'
  );
  assert.match(controller, /updateVolunteerEmergencyContact/);
  assert.match(controller, /vp\.emergency_contact_name/);
  assert.match(controller, /volunteer\.emergency_contact\.update/);
});

test('GDPR erase clears structured emergency contact fields', () => {
  const source = fs.readFileSync(path.join(ROOT, 'models/Gdpr.js'), 'utf8');
  assert.match(source, /emergency_contact_name = NULL/);
  assert.match(source, /emergency_contact_relationship = NULL/);
  assert.match(source, /emergency_contact_phone = NULL/);
});
