'use strict';

/**
 * Small RFC 4180 CSV reader for register downloads. Handles quoted fields,
 * doubled quotes, commas and newlines inside quotes, CRLF, and a leading
 * byte order mark. Returns an array of rows, each an array of strings.
 * Blank lines are dropped.
 */
function parseCsv(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      endRow();
      if (c === '\r' && src[i + 1] === '\n') i += 1;
    } else {
      field += c;
    }
    i += 1;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length) endRow();
  return rows;
}

module.exports = { parseCsv };
