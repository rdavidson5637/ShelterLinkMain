'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const shelterStore = new AsyncLocalStorage();

const TENANT_TABLES = [
  'admin_invites',
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
  'guardian_consents',
  'incidents',
  'induction_checklist_items',
  'induction_checklist_progress',
  'message_digest_log',
  'message_threads',
  'messages',
  'memberships',
  'mileage_claims',
  'opportunities',
  'opportunity_animals',
  'opportunity_match_queue',
  'opportunity_qualifications',
  'opportunity_tags',
  'opportunity_templates',
  'push_subscriptions',
  'qualifications',
  'shelter_announcements',
  'shelter_booking_policy',
  'shelter_closures',
  'shelter_settings',
  'shelter_wishlist_items',
  'shelters',
  'shift_feedback',
  'shift_notes',
  'swap_requests',
  'tag_digest_log',
  'tags',
  'thread_participants',
  'training_attempts',
  'training_modules',
  'training_questions',
  'transport_legs',
  'transport_runs',
  'trusted_volunteers',
  'user_documents',
  'users',
  'volunteer_buddies',
  'volunteer_hours',
  'volunteer_milestone_emails',
  'volunteer_profiles',
  'volunteer_qualifications',
  'volunteer_references',
  'volunteer_staff_notes',
  'volunteer_tags',
  'volunteer_usual_availability',
  'waitlist_offers',
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
