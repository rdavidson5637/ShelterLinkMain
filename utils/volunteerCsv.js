'use strict';

/**
 * Volunteer CSV import (SL-LATER-32): parse and check a spreadsheet export
 * before anything is written. Pure functions, no database.
 *
 * Accepted columns (header names are matched loosely, case and spacing
 * ignored): name, or first name + last name; email; phone; date of birth.
 * Email and a name are required. Phone and date of birth are optional.
 *
 * CSV injection: a cell that starts with = + - @ or a control character is
 * refused, except a phone number starting with +, which must then be digits.
 * So nothing formula-like is stored and later re-exported to a spreadsheet.
 */

const MAX_BYTES = 256 * 1024;
const MAX_ROWS = 500;
const NAME_MAX = 100;
const EMAIL_MAX = 254;

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,24}$/;
const FORMULA_START = /^[=+\-@\t\r\n]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const HEADER_ALIASES = {
  name: ['name', 'fullname', 'volunteer', 'volunteername'],
  first_name: ['firstname', 'forename', 'givenname', 'first'],
  last_name: ['lastname', 'surname', 'familyname', 'last'],
  email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'tel', 'mobilephone'],
  date_of_birth: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'dateofbirthoptional'],
};

class CsvImportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** RFC 4180 style parser: quoted fields, doubled quotes, CRLF or LF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) throw new CsvImportError('The file has a quote that is never closed. Check the file in your spreadsheet and export it again.');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function headerKey(cell) {
  return String(cell || '').toLowerCase().replace(/[^a-z]/g, '');
}

function mapHeader(cells) {
  const columns = {};
  cells.forEach((cell, index) => {
    const key = headerKey(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && columns[field] === undefined) {
        columns[field] = index;
        break;
      }
    }
  });
  if (columns.email === undefined) {
    throw new CsvImportError('The first row must name the columns, and one must be called email.');
  }
  if (columns.name === undefined && (columns.first_name === undefined || columns.last_name === undefined)) {
    throw new CsvImportError('Add a name column, or first name and last name columns.');
  }
  return columns;
}

function isBlankRow(cells) {
  return cells.every((cell) => String(cell || '').trim() === '');
}

function unsafeCell(value) {
  if (FORMULA_START.test(value)) return 'starts with a character spreadsheets treat as a formula';
  if (CONTROL_CHARS.test(value)) return 'contains a tab, line break or control character';
  return null;
}

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** YYYY-MM-DD or DD/MM/YYYY (UK order) to YYYY-MM-DD, or null. */
function parseDateOfBirth(value, today = new Date()) {
  const raw = String(value || '').trim();
  let y;
  let m;
  let d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(raw);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (!validDate(y, m, d)) return null;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayIso = today.toISOString().slice(0, 10);
  if (iso >= todayIso) return null;
  if (y < today.getUTCFullYear() - 120) return null;
  return iso;
}

function splitName(full) {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function checkRow(cells, columns, today) {
  const cell = (field) => (columns[field] === undefined ? '' : String(cells[columns[field]] || '').trim());
  const errors = [];
  const out = {
    first_name: '',
    last_name: '',
    email: cell('email').toLowerCase(),
    phone: cell('phone'),
    date_of_birth: null,
  };

  for (const field of ['name', 'first_name', 'last_name', 'email', 'phone', 'date_of_birth']) {
    const value = cell(field);
    // A phone number may start with +; the phone pattern below then allows only digits.
    const problem = field === 'phone' && value.startsWith('+') && !CONTROL_CHARS.test(value) ? null : unsafeCell(value);
    if (problem) errors.push(`${field.replace(/_/g, ' ')} ${problem}`);
  }

  if (columns.first_name !== undefined && columns.last_name !== undefined && (cell('first_name') || cell('last_name'))) {
    out.first_name = cell('first_name');
    out.last_name = cell('last_name');
  } else if (cell('name')) {
    const split = splitName(cell('name'));
    if (split) {
      out.first_name = split.first;
      out.last_name = split.last;
    } else {
      out.first_name = cell('name');
    }
  }
  if (!out.first_name || !out.last_name) errors.push('needs a first and last name');
  if (/[<>]/.test(out.first_name + out.last_name)) errors.push('name contains < or >');
  if (out.first_name.length > NAME_MAX || out.last_name.length > NAME_MAX) errors.push(`name is longer than ${NAME_MAX} characters`);

  if (!out.email) errors.push('email is missing');
  else if (out.email.length > EMAIL_MAX || !EMAIL_RE.test(out.email)) errors.push('email does not look like name@example.org');

  if (out.phone && !PHONE_RE.test(out.phone)) errors.push('phone should be digits, spaces and an optional leading +');

  const dob = cell('date_of_birth');
  if (dob) {
    out.date_of_birth = parseDateOfBirth(dob, today);
    if (!out.date_of_birth) errors.push('date of birth should be a past date like 2001-04-30 or 30/04/2001');
  }

  return { ...out, phone: out.phone || null, errors: [...new Set(errors)] };
}

/**
 * Turn CSV text into checked rows. Throws CsvImportError for problems with
 * the file as a whole (size, header, row count). Row problems are returned
 * on the row so the preview can show every one.
 *
 * Row numbers are spreadsheet line numbers (header is line 1).
 */
function readVolunteerCsv(text, { today = new Date() } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new CsvImportError('Choose a CSV file with a header row and at least one volunteer.');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw new CsvImportError(`The file is larger than ${MAX_BYTES / 1024} KB. Split it into smaller files.`);
  }
  const all = parseCsv(text.replace(/^﻿/, ''));
  const headerIndex = all.findIndex((cells) => !isBlankRow(cells));
  if (headerIndex === -1) throw new CsvImportError('Choose a CSV file with a header row and at least one volunteer.');
  const columns = mapHeader(all[headerIndex]);

  const rows = [];
  for (let i = headerIndex + 1; i < all.length; i += 1) {
    if (isBlankRow(all[i])) continue;
    rows.push({ row: i + 1, ...checkRow(all[i], columns, today) });
    if (rows.length > MAX_ROWS) {
      throw new CsvImportError(`The file has more than ${MAX_ROWS} volunteers. Split it into smaller files.`);
    }
  }
  if (!rows.length) throw new CsvImportError('The file has a header row but no volunteers under it.');

  // The same address twice in one file: keep the first, flag the rest.
  const firstRow = new Map();
  for (const row of rows) {
    if (!row.email || row.errors.length) continue;
    if (firstRow.has(row.email)) {
      row.errors.push(`same email as row ${firstRow.get(row.email)}`);
    } else {
      firstRow.set(row.email, row.row);
    }
  }
  return { columns: Object.keys(columns), rows };
}

module.exports = {
  MAX_BYTES,
  MAX_ROWS,
  CsvImportError,
  parseCsv,
  parseDateOfBirth,
  readVolunteerCsv,
};
