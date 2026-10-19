'use strict';

/**
 * Optional production error reporting (Sentry). Does nothing unless SENTRY_DSN
 * is set. Volunteer data is personal, so nothing identifying leaves the
 * server: request bodies, cookies, auth headers and user objects are dropped,
 * and email addresses and phone numbers are redacted from error text.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// UK-style numbers: 07700 900201, 028 9083 0001, +44 7700 900201
const PHONE_RE = /(?:\+44[\s-]?|\b0)\d(?:[\s-]?\d){8,10}\b/g;

function redactText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}

function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (/^(authorization|cookie|set-cookie|x-csrf-token)$/i.test(key)) {
          delete event.request.headers[key];
        }
      }
    }
    if (typeof event.request.url === 'string') event.request.url = redactText(event.request.url);
  }

  delete event.user;
  if (event.extra) delete event.extra;

  if (typeof event.message === 'string') event.message = redactText(event.message);
  if (event.exception && Array.isArray(event.exception.values)) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === 'string') ex.value = redactText(ex.value);
    }
  }
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => {
      const { data, ...rest } = b || {};
      void data;
      return typeof rest.message === 'string' ? { ...rest, message: redactText(rest.message) } : rest;
    });
  }
  return event;
}

let sentry = null;

function initSentry(env = process.env) {
  const dsn = String(env.SENTRY_DSN || '').trim();
  if (!dsn || sentry) return Boolean(sentry);
  // Loaded lazily so the package costs nothing when it is not configured.
  // eslint-disable-next-line global-require
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    environment: String(env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'production').trim(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  sentry = Sentry;
  return true;
}

/** Report an error. Safe to call anywhere: a no-op unless Sentry is enabled. */
function captureError(error, { tags } = {}) {
  if (!sentry) return;
  try {
    sentry.withScope((scope) => {
      if (tags) scope.setTags(tags);
      sentry.captureException(error);
    });
  } catch (_) {
    /* never let reporting break the request */
  }
}

module.exports = { initSentry, captureError, scrubEvent, redactText };
