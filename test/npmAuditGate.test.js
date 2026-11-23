'use strict';

/**
 * SL-LATER-37: npm audit CI gate + reviewed allowlist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_ALLOWLIST,
  loadAllowlist,
  collectHighCriticalAdvisories,
  findExpiredAllowlistEntries,
  evaluateAudit,
  formatReport,
} = require('../scripts/npm-audit-gate');

const ROOT = path.join(__dirname, '..');

const sampleAudit = {
  vulnerabilities: {
    zod: {
      name: 'zod',
      severity: 'high',
      via: [
        {
          source: 1243066,
          name: 'zod',
          title: 'Zod can exhaust memory while validating oversized constrained collections',
          url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
          severity: 'high',
        },
      ],
    },
    leftpad: {
      name: 'leftpad',
      severity: 'moderate',
      via: [
        {
          source: 1,
          name: 'leftpad',
          title: 'moderate only',
          url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
          severity: 'moderate',
        },
      ],
    },
  },
};

test('repo allowlist file loads and uses required fields', () => {
  assert.equal(path.basename(DEFAULT_ALLOWLIST), 'npm-audit-allowlist.json');
  assert.ok(fs.existsSync(DEFAULT_ALLOWLIST));
  const entries = loadAllowlist();
  assert.ok(entries.length >= 1);
  for (const entry of entries) {
    assert.ok(entry.id);
    assert.ok(entry.reason.length > 10);
    assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('collectHighCriticalAdvisories ignores moderate and keeps high', () => {
  const found = collectHighCriticalAdvisories(sampleAudit);
  assert.equal(found.length, 1);
  assert.equal(found[0].package, 'zod');
  assert.equal(found[0].severity, 'high');
  assert.equal(found[0].id, 'GHSA-mrhx-c7xc-m3w5');
  assert.ok(found[0].ids.includes('1243066'));
});

test('evaluateAudit passes when advisory is allowlisted and reviewBy is future', () => {
  const allowlist = [
    {
      id: 'GHSA-mrhx-c7xc-m3w5',
      reason: 'waiting on zod 4 migration',
      reviewBy: '2099-01-01',
    },
  ];
  const result = evaluateAudit({
    auditReport: sampleAudit,
    allowlist,
    today: '2026-11-23',
  });
  assert.equal(result.ok, true);
  assert.equal(result.expired.length, 0);
  assert.equal(result.unapproved.length, 0);
  assert.match(formatReport(result), /passed/);
});

test('evaluateAudit fails when high advisory is missing from allowlist', () => {
  const result = evaluateAudit({
    auditReport: sampleAudit,
    allowlist: [],
    today: '2026-11-23',
  });
  assert.equal(result.ok, false);
  assert.equal(result.unapproved.length, 1);
  assert.equal(result.unapproved[0].reason, 'not_allowlisted');
});

test('evaluateAudit fails when allowlist reviewBy has expired', () => {
  const allowlist = [
    {
      id: 'GHSA-mrhx-c7xc-m3w5',
      reason: 'stale exception',
      reviewBy: '2026-01-01',
    },
  ];
  const result = evaluateAudit({
    auditReport: sampleAudit,
    allowlist,
    today: '2026-11-23',
  });
  assert.equal(result.ok, false);
  assert.equal(result.expired.length, 1);
  assert.equal(result.unapproved[0].reason, 'allowlist_expired');
});

test('expired allowlist entries fail even without a matching advisory', () => {
  const allowlist = [
    {
      id: 'GHSA-old-old-old1',
      reason: 'remove me',
      reviewBy: '2020-01-01',
    },
  ];
  const result = evaluateAudit({
    auditReport: { vulnerabilities: {} },
    allowlist,
    today: '2026-11-23',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(
    findExpiredAllowlistEntries(allowlist, '2026-11-23').map((e) => e.id),
    ['GHSA-old-old-old1']
  );
});

test('allowlist matches npm numeric source id as well as GHSA', () => {
  const allowlist = [
    {
      id: '1243066',
      reason: 'numeric id form',
      reviewBy: '2099-01-01',
    },
  ];
  const result = evaluateAudit({
    auditReport: sampleAudit,
    allowlist,
    today: '2026-11-23',
  });
  assert.equal(result.ok, true);
});

test('committed allowlist covers current production high/critical findings', () => {
  // Live check against the lockfile so CI and local stay aligned.
  const { runNpmAuditJson } = require('../scripts/npm-audit-gate');
  const allowlist = loadAllowlist(path.join(ROOT, 'npm-audit-allowlist.json'));
  const auditReport = runNpmAuditJson(ROOT);
  const result = evaluateAudit({ auditReport, allowlist });
  assert.equal(
    result.ok,
    true,
    formatReport(result)
  );
});
