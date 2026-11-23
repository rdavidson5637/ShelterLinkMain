'use strict';

/**
 * Short, human device label from a User-Agent string, e.g.
 * "Safari on iPhone" or "Firefox on Windows". Only this label is kept in the
 * session; the raw User-Agent is never stored or shown.
 */
const BROWSERS = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*Safari\//, 'Safari'],
];

const PLATFORMS = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'Chromebook'],
  [/\bWindows\b/, 'Windows'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bLinux\b/, 'Linux'],
];

function pick(list, ua) {
  for (const [re, label] of list) {
    if (re.test(ua)) return label;
  }
  return null;
}

function summarizeUserAgent(userAgent) {
  const ua = String(userAgent || '').slice(0, 512);
  if (!ua.trim()) return 'Unknown device';
  const browser = pick(BROWSERS, ua);
  const platform = pick(PLATFORMS, ua);
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return `Browser on ${platform}`;
  return 'Unknown device';
}

/** Stamp the device label and sign-in time on a freshly signed-in session. */
function recordSignInDevice(req) {
  if (!req || !req.session) return;
  const header = req.headers && (req.headers['user-agent'] || req.headers['User-Agent']);
  const ua = typeof req.get === 'function' ? req.get('user-agent') || header : header;
  req.session.device = summarizeUserAgent(ua);
  if (!req.session.loginAt) req.session.loginAt = Date.now();
}

module.exports = { summarizeUserAgent, recordSignInDevice };
