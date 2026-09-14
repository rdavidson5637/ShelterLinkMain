'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isTestOrE2EOpportunity,
  excludeTestOpportunities,
} = require('../utils/testOpportunityGuard');

test('detects smoke-test and E2E titles', () => {
  assert.strictEqual(isTestOrE2EOpportunity({ title: 'Smoke Test Shift 123' }), true);
  assert.strictEqual(isTestOrE2EOpportunity({ title: 'Kennel E2E cover' }), true);
  assert.strictEqual(isTestOrE2EOpportunity({
    title: 'Walk dogs',
    description: 'Automated end-to-end test shift.',
  }), true);
  assert.strictEqual(isTestOrE2EOpportunity({ title: 'Saturday kennel clean' }), false);
});

test('excludeTestOpportunities only filters in production', () => {
  const rows = [
    { title: 'Smoke Test Shift 1' },
    { title: 'Real kennel shift' },
  ];
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  assert.strictEqual(excludeTestOpportunities(rows).length, 2);
  process.env.NODE_ENV = 'production';
  const filtered = excludeTestOpportunities(rows);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].title, 'Real kennel shift');
  process.env.NODE_ENV = prev;
});
