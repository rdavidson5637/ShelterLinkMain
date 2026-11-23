#!/usr/bin/env node
'use strict';

/**
 * ShelterLink — post-deploy smoke check (read-only)
 * ---------------------------------------------------------------------------
 * Hits key public pages and APIs against a running deployment. GET only.
 * Does not register users, create shifts, or send mail.
 *
 * Usage:
 *   npm run smoke
 *   SMOKE_BASE_URL=https://shelterlink.online npm run smoke
 *   SMOKE_BASE_URL=http://localhost:3000 npm run smoke
 *
 * Exit 0 = all checks passed, 1 = one or more failed.
 */

const BASE = (process.env.SMOKE_BASE_URL || 'https://shelterlink.online').replace(/\/$/, '');

// Whole-word / URI patterns only — avoid false hits on fields like colourTokens.
const SECRETISH =
  /\b(password|secret|database_url|connection[_ -]?string|api[_-]?key|bearer)\b|postgres(ql)?:\/\/|["']?access[_-]?token["']?\s*:/i;

let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`);
  }
  return cond;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: '*/*' },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

function assertNoSecrets(label, payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return ok(`${label} has no secrets in the body`, !SECRETISH.test(raw || ''));
}

async function expectStatus(path, want) {
  const res = await get(path);
  ok(`${path} → ${want}`, res.status === want, `got ${res.status}`);
  return res;
}

async function expectHtml(path) {
  const res = await expectStatus(path, 200);
  if (res.status === 200) {
    ok(
      `${path} looks like HTML`,
      /<!doctype html|<html[\s>]/i.test(res.text),
      'body was not HTML'
    );
  }
  return res;
}

async function expectJson(path) {
  const res = await expectStatus(path, 200);
  if (res.status === 200) {
    ok(`${path} returns JSON`, res.json !== null, 'body was not JSON');
    if (res.json !== null) assertNoSecrets(path, res.json);
  }
  return res;
}

async function main() {
  console.log(`ShelterLink post-deploy smoke (read-only) → ${BASE}\n`);

  // Health: app up + DB ping, no secrets.
  const healthz = await get('/healthz');
  if (!ok('/healthz → 200', healthz.status === 200, `got ${healthz.status}`)) {
    console.log('\nAborting: /healthz is not healthy.');
    process.exit(1);
  }
  ok('/healthz reports db true', healthz.json && healthz.json.db === true, JSON.stringify(healthz.json));
  ok(
    '/healthz body is only the db flag',
    healthz.json && Object.keys(healthz.json).length === 1 && 'db' in healthz.json,
    JSON.stringify(healthz.json)
  );
  assertNoSecrets('/healthz', healthz.json);

  const apiHealth = await get('/api/health');
  ok('/api/health → 200', apiHealth.status === 200, `got ${apiHealth.status}`);
  if (apiHealth.status === 200) {
    ok('/api/health status is ok', apiHealth.json && apiHealth.json.status === 'ok', JSON.stringify(apiHealth.json));
    assertNoSecrets('/api/health', apiHealth.json);
  }

  // Public HTML pages
  await expectHtml('/');
  await expectHtml('/register');
  await expectHtml('/login.html');
  await expectHtml('/pages/opportunities.html');
  await expectHtml('/pages/group-booking.html');
  await expectHtml('/pages/privacy.html');

  // Public APIs
  const apiRoot = await expectStatus('/api', 200);
  if (apiRoot.status === 200) {
    ok(
      '/api says the API is running',
      /ShelterLink API Running/i.test(apiRoot.text),
      apiRoot.text.slice(0, 80)
    );
    assertNoSecrets('/api', apiRoot.text);
  }
  await expectJson('/api/public/config');
  await expectJson('/api/public/brand');
  const opps = await expectJson('/api/public/opportunities');
  if (opps.json !== null) {
    ok(
      '/api/public/opportunities is a list or wrapped list',
      Array.isArray(opps.json) || Array.isArray(opps.json.opportunities) || Array.isArray(opps.json.data),
      typeof opps.json
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke check crashed:', err && err.message ? err.message : err);
  process.exit(1);
});
