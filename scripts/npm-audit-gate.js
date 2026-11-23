#!/usr/bin/env node
'use strict';

/**
 * Fail CI when production dependencies have high or critical npm advisories
 * that are not covered by a non-expired entry in npm-audit-allowlist.json.
 *
 *   node scripts/npm-audit-gate.js
 *   npm run audit:deps
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_ALLOWLIST = path.join(ROOT, 'npm-audit-allowlist.json');
const FAIL_SEVERITIES = new Set(['high', 'critical']);

function todayUtcDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function loadAllowlist(filePath = DEFAULT_ALLOWLIST) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`Allowlist must be a JSON array: ${filePath}`);
  }
  return data.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Allowlist entry ${index} must be an object`);
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    const reviewBy =
      typeof entry.reviewBy === 'string' ? entry.reviewBy.trim() : '';
    if (!id) throw new Error(`Allowlist entry ${index} missing id`);
    if (!reason) throw new Error(`Allowlist entry ${index} missing reason`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) {
      throw new Error(
        `Allowlist entry ${index} (${id}) reviewBy must be YYYY-MM-DD`
      );
    }
    return { id, reason, reviewBy };
  });
}

function extractGhsa(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/GHSA-[a-z0-9-]+/i);
  return match ? match[0] : null;
}

function advisoryIdsFromVia(via) {
  const ids = new Set();
  if (!via || typeof via !== 'object') return ids;
  if (via.source != null) ids.add(String(via.source));
  const fromUrl = extractGhsa(via.url);
  if (fromUrl) ids.add(fromUrl);
  return ids;
}

function collectHighCriticalAdvisories(auditReport) {
  const found = [];
  const vulns = (auditReport && auditReport.vulnerabilities) || {};
  for (const [pkg, entry] of Object.entries(vulns)) {
    const viaList = Array.isArray(entry.via) ? entry.via : [];
    for (const via of viaList) {
      if (typeof via === 'string') continue;
      const severity = String(via.severity || entry.severity || '').toLowerCase();
      if (!FAIL_SEVERITIES.has(severity)) continue;
      const ids = advisoryIdsFromVia(via);
      const ghsaMatch =
        typeof via.url === 'string' ? via.url.match(/GHSA-[a-z0-9-]+/i) : null;
      const primaryId = ghsaMatch
        ? ghsaMatch[0]
        : via.source != null
          ? String(via.source)
          : pkg;
      found.push({
        package: pkg,
        severity,
        title: via.title || entry.title || pkg,
        url: via.url || null,
        id: primaryId,
        ids: [...ids, primaryId],
      });
    }
    // Parent severity high/critical with only string via (transitive meta)
    if (
      FAIL_SEVERITIES.has(String(entry.severity || '').toLowerCase()) &&
      viaList.every((v) => typeof v === 'string') &&
      viaList.length === 0
    ) {
      found.push({
        package: pkg,
        severity: String(entry.severity).toLowerCase(),
        title: pkg,
        url: null,
        id: pkg,
        ids: [pkg],
      });
    }
  }
  return found;
}

function findExpiredAllowlistEntries(allowlist, today = todayUtcDateString()) {
  return allowlist.filter((entry) => entry.reviewBy < today);
}

function isAllowlisted(advisory, allowlist) {
  const candidates = new Set(
    (advisory.ids || []).map((id) => String(id).toLowerCase())
  );
  candidates.add(String(advisory.id).toLowerCase());
  return allowlist.find((entry) => candidates.has(entry.id.toLowerCase()));
}

function evaluateAudit({ auditReport, allowlist, today = todayUtcDateString() }) {
  const expired = findExpiredAllowlistEntries(allowlist, today);
  const advisories = collectHighCriticalAdvisories(auditReport);
  const unapproved = [];
  for (const advisory of advisories) {
    const hit = isAllowlisted(advisory, allowlist);
    if (!hit) {
      unapproved.push({ advisory, reason: 'not_allowlisted' });
      continue;
    }
    if (hit.reviewBy < today) {
      unapproved.push({ advisory, reason: 'allowlist_expired', entry: hit });
    }
  }
  return { expired, advisories, unapproved, ok: expired.length === 0 && unapproved.length === 0 };
}

function runNpmAuditJson(cwd = ROOT) {
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', '--json'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  const stdout = result.stdout || '';
  if (!stdout.trim()) {
    const err = (result.stderr || '').trim() || `npm audit exited ${result.status}`;
    throw new Error(err);
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm audit returned non-JSON output: ${error.message}`);
  }
  // npm may set error.code when the lockfile is missing; treat that as hard fail
  if (report.error && !report.vulnerabilities) {
    throw new Error(
      `npm audit error: ${report.error.summary || report.error.message || JSON.stringify(report.error)}`
    );
  }
  return report;
}

function formatReport(evaluation) {
  const lines = [];
  if (evaluation.expired.length) {
    lines.push('Expired npm audit allowlist entries (reviewBy is in the past):');
    for (const entry of evaluation.expired) {
      lines.push(`  - ${entry.id} reviewBy=${entry.reviewBy}: ${entry.reason}`);
    }
  }
  if (evaluation.unapproved.length) {
    lines.push('High/critical production advisories not covered by a valid allowlist entry:');
    for (const item of evaluation.unapproved) {
      const a = item.advisory;
      const extra =
        item.reason === 'allowlist_expired'
          ? ` (allowlist expired ${item.entry.reviewBy})`
          : '';
      lines.push(
        `  - ${a.severity} ${a.package} ${a.id}${extra}: ${a.title}${a.url ? ` ${a.url}` : ''}`
      );
    }
  }
  if (!lines.length) {
    const n = evaluation.advisories.length;
    lines.push(
      n
        ? `npm audit gate passed (${n} high/critical advisory(ies) covered by allowlist).`
        : 'npm audit gate passed (no high/critical production advisories).'
    );
  }
  return lines.join('\n');
}

function main() {
  const allowlist = loadAllowlist();
  const auditReport = runNpmAuditJson();
  const evaluation = evaluateAudit({ auditReport, allowlist });
  const text = formatReport(evaluation);
  if (evaluation.ok) {
    console.log(text);
    return 0;
  }
  console.error(text);
  console.error(
    '\nFix with a patch/minor upgrade, or add/update a reviewed allowlist row in npm-audit-allowlist.json (id, reason, reviewBy).'
  );
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_ALLOWLIST,
  FAIL_SEVERITIES,
  todayUtcDateString,
  loadAllowlist,
  collectHighCriticalAdvisories,
  findExpiredAllowlistEntries,
  isAllowlisted,
  evaluateAudit,
  formatReport,
  runNpmAuditJson,
};
