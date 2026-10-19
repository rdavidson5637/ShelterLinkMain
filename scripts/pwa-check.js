'use strict';

const http = require('http');
const https = require('https');

const args = process.argv.slice(2).filter((a) => a !== '--');
const BASE = (args[0] || 'http://localhost:3000').replace(/\/$/, '');

let failed = 0;

function line(status, label, detail) {
  const extra = detail ? ` ${detail}` : '';
  console.log(`${status} ${label}${extra}`);
  if (status === 'FAIL') failed += 1;
}

async function get(pathname, { redirect = 'manual', headers = {} } = {}) {
  const res = await fetch(`${BASE}${pathname}`, { redirect, headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, text: buf.toString('utf8') };
}

function contentType(res) {
  return String(res.headers.get('content-type') || '').toLowerCase();
}

function rawResponseHeaders(pathname, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${pathname}`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { method: 'GET', headers: extraHeaders },
      (res) => {
        res.resume();
        resolve(res.headers);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    const sw = await get('/sw.js');
    const swOk =
      sw.res.status === 200 &&
      contentType(sw.res).includes('javascript') &&
      String(sw.res.headers.get('service-worker-allowed') || '') === '/' &&
      /no-cache/i.test(String(sw.res.headers.get('cache-control') || '')) &&
      !sw.text.includes('__SW_VERSION__');
    line(swOk ? 'PASS' : 'FAIL', 'GET /sw.js', `${sw.res.status} ${contentType(sw.res)}`);
  } catch (error) {
    line('FAIL', 'GET /sw.js', error.message);
  }

  try {
    const old = await get('/public/sw.js');
    const ok = old.res.status === 200 && old.text.includes('unregister');
    line(ok ? 'PASS' : 'FAIL', 'GET /public/sw.js kill-switch');
  } catch (error) {
    line('FAIL', 'GET /public/sw.js', error.message);
  }

  try {
    const man = await get('/public/manifest.webmanifest');
    const json = JSON.parse(man.text);
    const maskable = (json.icons || []).some((icon) => String(icon.purpose || '').includes('maskable'));
    const ok =
      man.res.status === 200 &&
      json.id === '/' &&
      json.scope === '/' &&
      json.start_url &&
      json.display === 'standalone' &&
      maskable;
    line(ok ? 'PASS' : 'FAIL', 'GET /public/manifest.webmanifest');
    for (const icon of json.icons || []) {
      const src = icon.src.startsWith('http') ? icon.src : icon.src;
      const iconRes = await get(src);
      const imageOk = iconRes.res.status === 200 && contentType(iconRes.res).startsWith('image/');
      line(imageOk ? 'PASS' : 'FAIL', `icon ${src}`, String(iconRes.res.status));
    }
  } catch (error) {
    line('FAIL', 'manifest', error.message);
  }

  for (const p of ['/public/icons/apple-touch-icon.png', '/public/icons/badge-96.png']) {
    try {
      const r = await get(p);
      line(r.res.status === 200 ? 'PASS' : 'FAIL', `GET ${p}`, String(r.res.status));
    } catch (error) {
      line('FAIL', `GET ${p}`, error.message);
    }
  }

  try {
    const off = await get('/offline.html');
    const ok = off.res.status === 200 && !/\son[a-z]+=/i.test(off.text);
    line(ok ? 'PASS' : 'FAIL', 'GET /offline.html');
  } catch (error) {
    line('FAIL', 'GET /offline.html', error.message);
  }

  try {
    const launch = await get('/launch');
    const loc = launch.res.headers.get('location') || '';
    const ok = launch.res.status === 302 && loc.includes('/login.html');
    line(ok ? 'PASS' : 'FAIL', 'GET /launch', `${launch.res.status} ${loc}`);
  } catch (error) {
    line('FAIL', 'GET /launch', error.message);
  }

  try {
    const login = await get('/login.html', { headers: { 'Accept-Encoding': 'gzip, br' } });
    const csp = String(login.res.headers.get('content-security-policy') || '');
    const html = login.text;
    const cspOk = csp && !/script-src[^;]*unsafe-inline/.test(csp);
    const tagsOk = /apple-touch-icon/i.test(html) && /manifest/i.test(html);
    const raw = await rawResponseHeaders('/login.html', { 'Accept-Encoding': 'gzip, br' });
    const encoding = String(raw['content-encoding'] || '');
    const zipOk = /gzip|br/i.test(encoding);
    line(cspOk && tagsOk ? 'PASS' : 'FAIL', 'GET /login.html CSP and head tags');
    line(zipOk ? 'PASS' : 'FAIL', 'GET /login.html content-encoding', encoding || 'none');
  } catch (error) {
    line('FAIL', 'GET /login.html', error.message);
  }

  try {
    const vapid = await get('/api/push/vapid-public-key');
    const body = JSON.parse(vapid.text || '{}');
    if (body.configured === false || vapid.res.status >= 400) {
      line(
        'WARN',
        'GET /api/push/vapid-public-key',
        'Set WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY / WEB_PUSH_VAPID_SUBJECT on the host'
      );
    } else {
      line('PASS', 'GET /api/push/vapid-public-key');
    }
  } catch (error) {
    line('WARN', 'GET /api/push/vapid-public-key', error.message);
  }

  process.exit(failed ? 1 : 0);
}

main();
