'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'database');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const tenancy = fs.readFileSync(path.join(DB, '033_add_shelters.pg.sql'), 'utf8');
const selfServe = fs.readFileSync(path.join(DB, '036_self_serve_shelters.pg.sql'), 'utf8');

function columnsAndConstraints(sql) {
  const body = /CREATE TABLE (?:IF NOT EXISTS )?shelters \(([\s\S]*?)\n\);/.exec(sql);
  assert.ok(body, 'shelters table not found');
  const lines = body[1].split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
  for (const m of sql.matchAll(/ALTER TABLE shelters ADD COLUMN IF NOT EXISTS (.+);/g)) {
    lines.push(m[1]);
  }
  for (const m of sql.matchAll(/ALTER TABLE shelters ADD (CONSTRAINT .+);/g)) {
    lines.push(m[1]);
  }
  return lines.map((l) => l.replace(/\s+/g, ' ')).sort();
}

test('schema.pg.sql defines shelters the same way as 033 plus 036', () => {
  assert.deepEqual(columnsAndConstraints(schema), columnsAndConstraints(`${tenancy}\n${selfServe}`));
});

test('schema.pg.sql drops shelters with the other tables', () => {
  const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
  assert.ok(drop);
  assert.match(drop[1], /\bshelters\b/);
});
