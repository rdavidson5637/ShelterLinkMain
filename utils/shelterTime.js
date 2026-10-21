'use strict';

/**
 * The shelter's own local timezone (IANA name). Hosts usually run in UTC.
 */
const TIMEZONE = process.env.SHELTER_TIMEZONE || 'Europe/London';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let dateFormatter = null;
function getDateFormatter() {
  if (!dateFormatter) {
    dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
  }
  return dateFormatter;
}

let partsFormatter = null;
function getPartsFormatter() {
  if (!partsFormatter) {
    partsFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  return partsFormatter;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function partsMap(now) {
  const parts = getPartsFormatter().formatToParts(now);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

/** 'YYYY-MM-DD' for "today" in the shelter's timezone, not the server's. */
function todayIso(now = new Date()) {
  return getDateFormatter().format(now);
}

/** 'YYYY-MM-DD HH:mm:ss' wall-clock time in TIMEZONE. */
function nowLocalSql(now = new Date()) {
  const p = partsMap(now);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function splitNaive(value) {
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] != null ? Number(m[4]) : null,
    minute: m[5] != null ? Number(m[5]) : null,
    second: m[6] != null ? Number(m[6]) : 0,
  };
}

function formatShelterDate(value) {
  if (value == null || value === '') return 'TBA';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return 'TBA';
    const p = partsMap(value);
    const year = Number(p.year);
    const month = Number(p.month);
    const day = Number(p.day);
    const weekday = DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${weekday} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
  }
  const parts = splitNaive(value);
  if (!parts) return 'TBA';
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = DAY_NAMES[utc.getUTCDay()];
  return `${weekday} ${parts.day} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

function formatShelterTime(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const p = partsMap(value);
    return `${p.hour}:${p.minute}`;
  }
  const parts = splitNaive(value);
  if (!parts || parts.hour == null) return '';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

module.exports = {
  TIMEZONE,
  todayIso,
  nowLocalSql,
  formatShelterDate,
  formatShelterTime,
};
