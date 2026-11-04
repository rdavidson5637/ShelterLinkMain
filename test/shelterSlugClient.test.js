'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function load() {
  return import('../frontend/js/shelterSlug.js');
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('shelterSlugFrom reads /join/<slug>, /s/<slug>/..., then ?shelter=', async () => {
  const { shelterSlugFrom } = await load();
  assert.equal(shelterSlugFrom('/join/second', ''), 'second');
  assert.equal(shelterSlugFrom('/s/second', ''), 'second');
  assert.equal(shelterSlugFrom('/s/second/opportunities', '?shelter=assisi'), 'second');
  assert.equal(shelterSlugFrom('/register.html', '?shelter=second'), 'second');
  assert.equal(shelterSlugFrom('/register.html', '?shelter=Second'), 'second');
  assert.equal(shelterSlugFrom('/register.html', ''), null);
  assert.equal(shelterSlugFrom('/index.html', ''), null);
});

test('shelterSlugFrom drops anything that is not a slug', async () => {
  const { shelterSlugFrom } = await load();
  for (const bad of ['/join/bad%20slug', '/join/%E0%A4%A', '/join/a_b', '/join/-x', `/join/${'a'.repeat(101)}`]) {
    assert.equal(shelterSlugFrom(bad, ''), null, bad);
  }
  assert.equal(shelterSlugFrom('/register.html', '?shelter=%22onerror%3D'), null);
  assert.equal(shelterSlugFrom('/register.html', '?shelter_id=2'), null);
});

test('withShelterQuery and shelterLinkFor keep visitors on the same shelter', async () => {
  const { withShelterQuery, shelterLinkFor } = await load();
  assert.equal(withShelterQuery('/api/public/brand', 'second'), '/api/public/brand?shelter=second');
  assert.equal(withShelterQuery('/api/public/brand', null), '/api/public/brand');
  assert.equal(withShelterQuery('/api/x?a=1', 'second'), '/api/x?a=1&shelter=second');
  assert.equal(shelterLinkFor('/register.html', 'second'), '/join/second');
  assert.equal(shelterLinkFor('/pages/opportunities.html', 'second'), '/s/second/opportunities');
  assert.equal(shelterLinkFor('/pages/group-booking.html', 'second'), '/s/second/group-booking');
  assert.equal(shelterLinkFor('/index.html', 'second'), '/s/second');
  assert.equal(shelterLinkFor('/login.html', 'second'), '/login.html');
  assert.equal(shelterLinkFor('/register.html', null), '/register.html');
});

test('public pages send a slug, never a shelter id', () => {
  for (const rel of [
    'frontend/js/register.js',
    'frontend/js/brand.js',
    'frontend/js/public/opportunities.js',
    'frontend/js/public/group-booking.js',
    'frontend/js/shelterSlug.js',
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /shelter_id|shelterId/, rel);
  }
  assert.match(read('frontend/js/register.js'), /data\.shelter_slug = shelterSlug/);
  assert.match(read('frontend/js/public/group-booking.js'), /payload\.shelter_slug = shelterSlug/);
});

test('slug-aware public pages carry no hard-coded Assisi copy', () => {
  for (const rel of [
    'frontend/register.html',
    'frontend/index.html',
    'frontend/pages/opportunities.html',
    'frontend/pages/group-booking.html',
    'frontend/public/manifest.webmanifest',
  ]) {
    assert.doesNotMatch(read(rel), /Assisi/, rel);
  }
});
