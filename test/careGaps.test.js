'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mock = require('./helpers/mockDb');
const Animal = require('../models/Animal');
const { careGaps } = require('../controllers/animalController');
const { queries } = require('../validation/bodies');
const { runWithShelter, currentShelterId } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ROUTES = read('routes/animals.js');
const PAGE = read('frontend/pages/admin/care-gaps.html');
const PAGE_JS = read('frontend/js/admin/care-gaps.js');
const ANIMALS_HTML = read('frontend/pages/admin/animals.html');
const ANIMALS_JS = read('frontend/js/admin/animals.js');
const CREATE_JS = read('frontend/js/admin/create-opportunity.js');
const TENANT_ISO = read('test/tenantIsolation.run.js');

const NOW = new Date('2099-06-10T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

/**
 * Stand-in for Postgres: rows carry shelter_id and reads only see the
 * current shelter, the way RLS scopes animals and animal_activity.
 */
function installDb({ animals, activity }) {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM animals a/i.test(sql) && /LEFT JOIN LATERAL/i.test(sql)) {
      const sid = currentShelterId();
      assert.ok(sid, 'care gap query must run inside a shelter context');
      const offSite = new Set(params);
      const rows = animals
        .filter((a) => a.shelter_id === sid && !offSite.has(a.status))
        .map((a) => {
          const mine = activity
            .filter((x) => x.shelter_id === sid && x.animal_id === a.id)
            .sort((x, y) => y.logged_at - x.logged_at);
          const latest = (type) => mine.find((x) => !type || x.activity_type === type)?.logged_at || null;
          return {
            ...a,
            last_walk_at: latest('walk'),
            last_socialise_at: latest('socialise'),
            last_activity_at: latest(null),
            last_activity_type: mine[0]?.activity_type || null,
          };
        });
      return [rows];
    }
    return [[]];
  });
}

const ANIMALS = [
  { id: 1, shelter_id: 1, name: 'Biscuit', species: 'dog', status: 'available', kennel_ref: 'K1', arrival_date: daysAgo(30), created_at: daysAgo(30) },
  { id: 2, shelter_id: 1, name: 'Rolo', species: 'dog', status: 'medical', kennel_ref: 'K2', arrival_date: null, created_at: daysAgo(5) },
  { id: 3, shelter_id: 1, name: 'Pip', species: 'cat', status: 'reserved', kennel_ref: null, arrival_date: daysAgo(40), created_at: daysAgo(40) },
  { id: 4, shelter_id: 1, name: 'Gone', species: 'dog', status: 'adopted', kennel_ref: null, arrival_date: daysAgo(90), created_at: daysAgo(90) },
  { id: 5, shelter_id: 1, name: 'Away', species: 'dog', status: 'foster', kennel_ref: null, arrival_date: daysAgo(90), created_at: daysAgo(90) },
  { id: 9, shelter_id: 2, name: 'OtherDog', species: 'dog', status: 'available', kennel_ref: null, arrival_date: daysAgo(99), created_at: daysAgo(99) },
];
const ACTIVITY = [
  { shelter_id: 1, animal_id: 1, activity_type: 'walk', logged_at: daysAgo(3) },
  { shelter_id: 1, animal_id: 1, activity_type: 'socialise', logged_at: daysAgo(1) },
  { shelter_id: 1, animal_id: 3, activity_type: 'feed', logged_at: daysAgo(0.5) },
  { shelter_id: 2, animal_id: 9, activity_type: 'walk', logged_at: daysAgo(0.1) },
];

test('findCareGaps lists on-site animals, longest gap first, with walk/socialise/any', async () => {
  installDb({ animals: ANIMALS, activity: ACTIVITY });
  const result = await runWithShelter(1, () => Animal.findCareGaps({ now: NOW }));

  assert.equal(result.flag_days, 2);
  assert.deepEqual(result.animals.map((a) => a.name), ['Rolo', 'Biscuit', 'Pip']);

  const [rolo, biscuit, pip] = result.animals;
  assert.equal(rolo.never_logged, true);
  assert.equal(rolo.gap_days, 5, 'no activity counts from when the animal was added');
  assert.equal(rolo.flagged, true);

  assert.equal(biscuit.gap_days, 1, 'gap uses the latest activity of any kind');
  assert.equal(biscuit.last_walk_at.getTime(), daysAgo(3).getTime());
  assert.equal(biscuit.last_socialise_at.getTime(), daysAgo(1).getTime());
  assert.equal(biscuit.last_activity_type, 'socialise');
  assert.equal(biscuit.flagged, false);

  assert.equal(pip.gap_days, 0);
  assert.equal(pip.last_walk_at, null);
  assert.equal(result.total, 3);
  assert.equal(result.flagged_count, 1);
});

test('findCareGaps leaves out adopted and fostered animals', async () => {
  installDb({ animals: ANIMALS, activity: ACTIVITY });
  const result = await runWithShelter(1, () => Animal.findCareGaps({ now: NOW }));
  const names = result.animals.map((a) => a.name);
  assert.ok(!names.includes('Gone'));
  assert.ok(!names.includes('Away'));
  const call = mock.calls.find((c) => /LEFT JOIN LATERAL/.test(c.sql));
  assert.match(call.sql, /a\.status NOT IN \(\?, \?\)/);
  assert.deepEqual(call.params, ['adopted', 'foster']);
});

test('flag threshold is adjustable and clamped', async () => {
  installDb({ animals: ANIMALS, activity: ACTIVITY });
  const one = await runWithShelter(1, () => Animal.findCareGaps({ flagDays: '1', now: NOW }));
  assert.equal(one.flag_days, 1);
  assert.equal(one.flagged_count, 2);
  const ten = await runWithShelter(1, () => Animal.findCareGaps({ flagDays: 10, now: NOW }));
  assert.equal(ten.flagged_count, 0);

  assert.equal(Animal.normalizeFlagDays(undefined), 2);
  assert.equal(Animal.normalizeFlagDays(''), 2);
  assert.equal(Animal.normalizeFlagDays('0'), 2);
  assert.equal(Animal.normalizeFlagDays('-3'), 2);
  assert.equal(Animal.normalizeFlagDays('2.5'), 2);
  assert.equal(Animal.normalizeFlagDays('99'), 60);
  assert.equal(Animal.normalizeFlagDays('7'), 7);
});

test('isolation: another shelter only sees its own animals and activity', async () => {
  installDb({ animals: ANIMALS, activity: ACTIVITY });
  const result = await runWithShelter(2, () => Animal.findCareGaps({ now: NOW }));
  assert.deepEqual(result.animals.map((a) => a.name), ['OtherDog']);
  assert.equal(result.animals[0].gap_days, 0);
  assert.equal(result.animals[0].flagged, false);
});

test('care gap SQL reads animal_activity per animal with no shelter id from the client', () => {
  installDb({ animals: [], activity: [] });
  return runWithShelter(1, async () => {
    await Animal.findCareGaps({ flagDays: 3, now: NOW });
    const call = mock.calls.find((c) => /LEFT JOIN LATERAL/.test(c.sql));
    assert.match(call.sql, /FROM animal_activity aa\s+WHERE aa\.animal_id = a\.id/);
    assert.match(call.sql, /FILTER \(WHERE aa\.activity_type = 'walk'\)/);
    assert.match(call.sql, /FILTER \(WHERE aa\.activity_type = 'socialise'\)/);
    assert.doesNotMatch(call.sql, /shelter_id/);
  });
});

test('careGaps controller is staff only and passes days through', async () => {
  installDb({ animals: ANIMALS, activity: ACTIVITY });

  const anon = makeRes();
  await careGaps({ session: {}, query: {} }, anon);
  assert.equal(anon.statusCode, 401);

  const vol = makeRes();
  await careGaps({ session: { userId: 7, role: 'volunteer' }, query: {} }, vol);
  assert.equal(vol.statusCode, 403);

  const staff = makeRes();
  await runWithShelter(1, () =>
    careGaps({ session: { userId: 1, role: 'staff' }, query: { days: '1' } }, staff)
  );
  assert.equal(staff.statusCode, 200);
  assert.equal(staff.body.flag_days, 1);
  assert.ok(Array.isArray(staff.body.animals));
});

test('findAll returns last_walked_at for the animals list', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[{ id: 1, name: 'Biscuit', last_walked_at: daysAgo(3) }]]);
  const rows = await runWithShelter(1, () => Animal.findAll());
  assert.equal(rows[0].last_walked_at.getTime(), daysAgo(3).getTime());
  const sql = mock.calls[0].sql;
  assert.match(sql, /MAX\(aa\.logged_at\)[\s\S]*activity_type = 'walk'[\s\S]*AS last_walked_at/);
});

test('query validation accepts days only and rejects shelter_id', () => {
  assert.equal(queries.careGaps.safeParse({}).success, true);
  assert.equal(queries.careGaps.safeParse({ days: '3' }).success, true);
  assert.equal(queries.careGaps.safeParse({ days: 'abc' }).success, false);
  assert.equal(queries.careGaps.safeParse({ days: '999' }).success, false);
  assert.equal(queries.careGaps.safeParse({ shelter_id: '2' }).success, false);
});

test('route is staff-gated, declared before /:id, and probed for tenant isolation', () => {
  assert.match(ROUTES, /router\.get\('\/care-gaps', isAuthenticated, requireStaff, validateQuery\(queries\.careGaps\), careGaps\)/);
  assert.ok(ROUTES.indexOf("'/care-gaps'") < ROUTES.indexOf("router.get('/:id'"));
  assert.match(TENANT_ISO, /own\('GET', '\/api\/animals\/care-gaps'\)/);
  assert.match(TENANT_ISO, /\/api\/animals\/care-gaps\?shelter_id=1', expect: 'rejected'/);
});

test('care gaps page is a ruled table with links to the animal and to post a shift', () => {
  assert.match(PAGE, /<h1>Care gaps<\/h1>/);
  assert.match(PAGE, /<table>/);
  assert.match(PAGE, /Last walk<\/th>/);
  assert.match(PAGE, /Last socialise<\/th>/);
  assert.match(PAGE, /Last activity<\/th>/);
  assert.match(PAGE, /id="days"[^>]*value="2"/);
  assert.doesNotMatch(PAGE, /stat-card|feature-grid|card-grid|linear-gradient|radial-gradient/);
  assert.match(PAGE_JS, /\/animals\/care-gaps\?days=/);
  assert.match(PAGE_JS, /\/pages\/admin\/animals\.html\?animal=/);
  assert.match(PAGE_JS, /\/pages\/admin\/create-opportunity\.html\?animal_id=/);
  assert.match(PAGE_JS, /searchParams\.set\('days'/);
  assert.match(PAGE_JS, /Flagged: /, 'flag status is a text label, not colour alone');
  assert.doesNotMatch(PAGE_JS, /[\u{1F300}-\u{1FAFF}✅☐☑]/u);
});

test('animals list shows last walked and deep links from care gaps work', () => {
  assert.match(ANIMALS_HTML, /<th scope="col">Last walked<\/th>/);
  assert.match(ANIMALS_HTML, /care-gaps\.html/);
  assert.match(ANIMALS_JS, /animal\.last_walked_at/);
  assert.match(ANIMALS_JS, /get\('animal'\)/);
  assert.match(CREATE_JS, /get\('animal_id'\)/);
});

test('care gaps sits next to Animals in staff nav', async () => {
  const { ADMIN_PRIMARY, filterNavForRole } = await import('../frontend/js/components/navConfig.js');
  const ids = ADMIN_PRIMARY.map((i) => i.id);
  assert.equal(ids.indexOf('care-gaps'), ids.indexOf('animals') + 1);
  assert.ok(filterNavForRole(ADMIN_PRIMARY, 'staff').some((i) => i.id === 'care-gaps'));
});
