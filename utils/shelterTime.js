'use strict';

/**
 * The shelter's own local timezone (IANA name), used only to work out "what
 * calendar date is it right now" for defaults like the day sheet's default
 * date. Configurable because the app host almost never runs in the
 * shelter's timezone (most hosts default to UTC) — `new Date().toISOString()`
 * gives the HOST's UTC date, which silently becomes tomorrow's (or
 * yesterday's) date from the shelter's point of view once local time
 * crosses a UTC day boundary. Defaults to the Assisi deployment's timezone.
 */
const TIMEZONE = process.env.SHELTER_TIMEZONE || 'Europe/London';

let formatter = null;
function getFormatter() {
  // en-CA formats as YYYY-MM-DD; built lazily so a bad SHELTER_TIMEZONE
  // throws once, at first use, with a clear stack rather than at require time.
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
  }
  return formatter;
}

/** 'YYYY-MM-DD' for "today" in the shelter's timezone, not the server's. */
function todayIso(now = new Date()) {
  return getFormatter().format(now);
}

module.exports = { TIMEZONE, todayIso };
