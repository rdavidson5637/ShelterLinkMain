'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
for (const key of [
  'RETENTION_INACTIVE_VOLUNTEER_YEARS',
  'DATA_RETENTION_YEARS',
  'RETENTION_APPLICATION_YEARS',
  'RETENTION_HOURS_YEARS',
  'RETENTION_AUDIT_LOG_YEARS',
  'RETENTION_GROUP_BOOKING_YEARS',
  'RETENTION_RESET_TOKEN_HOURS',
]) {
  delete process.env[key];
}

const { periods, cutoffFrom } = require('../config/retention');
const mock = require('./helpers/mockDb');
const Gdpr = require('../models/Gdpr');

test('retention periods stay empty until they are set', () => {
  const value = periods();
  assert.strictEqual(value.inactiveVolunteerYears, null);
  assert.strictEqual(value.applicationYears, null);
  assert.strictEqual(value.hoursYears, null);
  assert.strictEqual(value.auditLogYears, null);
  assert.strictEqual(value.groupBookingYears, null);
  assert.strictEqual(value.resetTokenHours, null);
});

test('a set period is used and a blank one is ignored', () => {
  process.env.RETENTION_AUDIT_LOG_YEARS = '2';
  process.env.RETENTION_HOURS_YEARS = '';
  const value = periods();
  assert.strictEqual(value.auditLogYears, 2);
  assert.strictEqual(value.hoursYears, null);
  delete process.env.RETENTION_AUDIT_LOG_YEARS;
  delete process.env.RETENTION_HOURS_YEARS;
});

test('cutoff moves back by the given years', () => {
  const cutoff = cutoffFrom(new Date('2026-10-22T12:00:00Z'), 3, 'years');
  assert.strictEqual(cutoff.toISOString().slice(0, 10), '2023-10-22');
});

test('the retention job does nothing while the volunteer period is empty', async () => {
  mock.resetCalls();
  mock.setHandler(async () => {
    throw new Error('should not query');
  });
  const summary = await Gdpr.runDataRetention(new Date('2026-10-22T12:00:00Z'));
  assert.strictEqual(summary.skipped, true);
  assert.strictEqual(summary.anonymised, 0);
  assert.strictEqual(mock.calls.length, 0);
});
