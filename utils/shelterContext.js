'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const shelterStore = new AsyncLocalStorage();

const TENANT_TABLES = [
  'admin_messages',
  'animal_activity',
  'animal_photos',
  'animals',
  'applications',
  'audit_log',
  'background_checks',
  'certificates',
  'custom_field_values',
  'custom_fields',
  'foster_offers',
  'foster_placements',
  'foster_requests',
  'group_bookings',
  'incidents',
  'message_digest_log',
  'message_threads',
  'messages',
  'opportunities',
  'opportunity_animals',
  'opportunity_match_queue',
  'opportunity_qualifications',
  'opportunity_tags',
  'opportunity_templates',
  'push_subscriptions',
  'qualifications',
  'shelters',
  'shift_feedback',
  'shift_notes',
  'swap_requests',
  'tag_digest_log',
  'tags',
  'thread_participants',
  'transport_legs',
  'transport_runs',
  'user_documents',
  'users',
  'volunteer_hours',
  'volunteer_profiles',
  'volunteer_qualifications',
  'volunteer_references',
  'volunteer_tags',
  'waiver_acceptances',
  'waivers',
];

const TENANT_TABLE_RE = new RegExp(`\\b(?:${TENANT_TABLES.join('|')})\\b`, 'i');

function getStore() {
  return shelterStore.getStore() || null;
}

function currentShelterId() {
  const id = Number(getStore()?.shelterId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isBypass() {
  return Boolean(getStore()?.bypass);
}

function runWithShelter(shelterId, fn) {
  const id = Number(shelterId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Shelter context is missing');
    err.status = 403;
    throw err;
  }
  return shelterStore.run({ shelterId: id }, fn);
}

function runWithoutShelter(fn) {
  return shelterStore.run({ bypass: true }, fn);
}

function mentionsTenantTable(sql) {
  return TENANT_TABLE_RE.test(String(sql || ''));
}

module.exports = {
  TENANT_TABLES,
  shelterStore,
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
  mentionsTenantTable,
};
