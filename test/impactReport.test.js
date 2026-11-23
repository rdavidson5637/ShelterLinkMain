'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./helpers/mockDb');
const ctrl = require('../controllers/impactReportController');
const { buildPdf, toPdfText, escapePdfString } = require('../utils/simplePdf');
const { runWithShelter } = require('../utils/shelterContext');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}

function withData({
  hours = { approved_hours: '42.50', checkin_hours: '30.00', volunteers: '7', shifts: '12' },
  months = [
    { month: '2026-01', hours: '20.00', volunteers: '4' },
    { month: '2026-02', hours: '22.50', volunteers: '5' },
  ],
  activity = [
    { activity_type: 'walk', entries: '18', animals: '6' },
    { activity_type: 'feed', entries: '4', animals: '3' },
  ],
  animalsHelped = '8',
  shelterName = 'Test Sanctuary',
} = {}) {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM shelters/i.test(sql)) return [[{ name: shelterName }]];
    if (/GROUP BY TO_CHAR/i.test(sql)) return [months];
    if (/FROM volunteer_hours/i.test(sql)) return [[hours]];
    if (/GROUP BY activity_type/i.test(sql)) return [activity];
    if (/animals_helped/i.test(sql)) return [[{ animals_helped: animalsHelped }]];
    return [[]];
  });
}

const RANGE = { startDate: '2026-01-01', endDate: '2026-03-31' };

test('parseRange requires both dates', () => {
  assert.match(ctrl.parseRange({}).error, /start date and an end date/);
  assert.match(ctrl.parseRange({ startDate: '2026-01-01' }).error, /start date and an end date/);
});

test('parseRange rejects impossible dates, reversed ranges and over-long ranges', () => {
  assert.match(ctrl.parseRange({ startDate: '2026-02-30', endDate: '2026-03-01' }).error, /real dates/);
  assert.match(ctrl.parseRange({ startDate: '2026-03-01', endDate: '2026-02-01' }).error, /on or before/);
  assert.match(ctrl.parseRange({ startDate: '2015-01-01', endDate: '2026-01-01' }).error, /five years/);
  assert.deepEqual(ctrl.parseRange(RANGE), RANGE);
  assert.deepEqual(ctrl.parseRange({ startDate: '2026-05-05', endDate: '2026-05-05' }), {
    startDate: '2026-05-05',
    endDate: '2026-05-05',
  });
});

test('fetchImpactReport only counts approved hours and uses real columns', async () => {
  withData();
  const report = await ctrl.fetchImpactReport(RANGE);

  const hoursSql = mock.calls.filter((c) => /FROM volunteer_hours/i.test(c.sql));
  assert.equal(hoursSql.length, 2);
  for (const call of hoursSql) {
    assert.match(call.sql, /approved = 1/);
    assert.match(call.sql, /date >= \?::date/);
    assert.match(call.sql, /date <= \?::date/);
    assert.deepEqual(call.params, [RANGE.startDate, RANGE.endDate]);
  }
  assert.match(hoursSql[0].sql, /verified_by_checkin = 1/);
  assert.match(hoursSql[0].sql, /COUNT\(DISTINCT user_id\)/);
  assert.match(hoursSql[0].sql, /COUNT\(DISTINCT opportunity_id\)/);

  const activitySql = mock.calls.filter((c) => /FROM animal_activity/i.test(c.sql));
  assert.equal(activitySql.length, 2);
  for (const call of activitySql) {
    // End date is inclusive: logged_at before the start of the following day.
    assert.match(call.sql, /logged_at < \(\?::date \+ 1\)/);
    assert.deepEqual(call.params, [RANGE.startDate, RANGE.endDate]);
  }
  assert.match(activitySql[1].sql, /COUNT\(DISTINCT animal_id\)/);

  assert.deepEqual(report.summary, {
    approvedHours: 42.5,
    checkinVerifiedHours: 30,
    volunteers: 7,
    shifts: 12,
    walks: 18,
    animalsHelped: 8,
  });
  assert.equal(report.activity.length, 7);
  assert.deepEqual(report.activity.find((a) => a.type === 'socialise'), {
    type: 'socialise',
    label: 'Socialising',
    entries: 0,
    animals: 0,
  });
  assert.deepEqual(report.months, [
    { month: '2026-01', hours: 20, volunteers: 4 },
    { month: '2026-02', hours: 22.5, volunteers: 5 },
  ]);
});

test('report queries never select personal data', async () => {
  withData();
  await ctrl.fetchImpactReport(RANGE);
  for (const call of mock.calls) {
    assert.doesNotMatch(call.sql, /first_name|last_name|email|phone|date_of_birth|notes/i);
  }
});

test('an empty period reports zeros, not missing values', async () => {
  withData({
    hours: { approved_hours: '0', checkin_hours: '0', volunteers: '0', shifts: '0' },
    months: [],
    activity: [],
    animalsHelped: '0',
  });
  const report = await ctrl.fetchImpactReport(RANGE);
  assert.deepEqual(report.summary, {
    approvedHours: 0,
    checkinVerifiedHours: 0,
    volunteers: 0,
    shifts: 0,
    walks: 0,
    animalsHelped: 0,
  });
  const pdf = ctrl.reportToPdf(report, '', '2026-04-01').toString('latin1');
  assert.match(pdf, /No animal activity was logged in this period\./);
  assert.match(pdf, /No approved hours were recorded in this period\./);
});

test('GET JSON returns 400 for a missing range and does not query', async () => {
  withData();
  const res = makeRes();
  await ctrl.getImpactReport({ query: { startDate: '2026-01-01' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.length, 0);
});

test('GET JSON returns the report', async () => {
  withData();
  const res = makeRes();
  await ctrl.getImpactReport({ query: RANGE }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.walks, 18);
  assert.equal(res.body.startDate, RANGE.startDate);
});

test('GET CSV downloads labelled rows with the shelter and period', async () => {
  withData();
  const res = makeRes();
  await runWithShelter(1, () => ctrl.getImpactReportCsv({ query: RANGE }, res));
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.equal(
    res.headers['content-disposition'],
    'attachment; filename="impact-report-2026-01-01-to-2026-03-31.csv"'
  );
  const csv = String(res.body);
  assert.match(csv, /^"section","item","value"/);
  assert.match(csv, /"period","Shelter","Test Sanctuary"/);
  assert.match(csv, /"summary","Approved volunteer hours",42\.5/);
  assert.match(csv, /"summary","Animal walks logged",18/);
  assert.match(csv, /"summary","Animals helped \(any logged activity\)",8/);
  assert.match(csv, /"animal activity entries","Feeds",4/);
  assert.match(csv, /"approved hours by month","2026-02",22\.5/);
});

test('CSV neutralises a shelter name that looks like a formula', async () => {
  withData({ shelterName: '=HYPERLINK("x")' });
  const res = makeRes();
  await runWithShelter(1, () => ctrl.getImpactReportCsv({ query: RANGE }, res));
  assert.match(String(res.body), /"period","Shelter","'=HYPERLINK/);
});

test('GET PDF downloads a well-formed PDF with the figures', async () => {
  withData();
  const res = makeRes();
  await runWithShelter(1, () => ctrl.getImpactReportPdf({ query: RANGE }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /impact-report-2026-01-01-to-2026-03-31\.pdf/);
  assert.ok(Buffer.isBuffer(res.body));
  const pdf = res.body.toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.match(pdf, /Test Sanctuary - volunteer impact/);
  assert.match(pdf, /1 January 2026 to 31 March 2026/);
  assert.match(pdf, /Approved volunteer hours: 42\.5/);
  assert.match(pdf, /Animal walks logged: 18/);
  assert.match(pdf, /Walks: 18 entries, 6 animals/);
  assert.match(pdf, /February 2026: 22\.5 hours, 5 volunteers/);
});

test('PDF xref offsets point at each object', () => {
  const buf = buildPdf({ title: 'T', lines: [{ text: 'Hello (world) \\ test' }] });
  const pdf = buf.toString('latin1');
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref');
  const entries = pdf.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
  entries.forEach((line, i) => {
    const offset = Number(line.slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
  assert.match(pdf, /\(Hello \\\(world\\\) \\\\ test\) Tj/);
});

test('PDF flows long content onto further pages', () => {
  const lines = Array.from({ length: 120 }, (_, i) => ({ text: `Line ${i}` }));
  const pdf = buildPdf({ lines }).toString('latin1');
  const count = Number(pdf.match(/\/Count (\d+)/)[1]);
  assert.ok(count >= 2, `expected at least two pages, got ${count}`);
});

test('PDF text helpers keep output to safe single-byte characters', () => {
  assert.equal(toPdfText('Kathy’s “walks” – 5…'), 'Kathy\'s "walks" - 5...');
  assert.equal(toPdfText('Café\nnext'), 'Caf? next');
  assert.equal(escapePdfString('a(b)\\c'), 'a\\(b\\)\\\\c');
});

test('impact report routes are staff/admin only and validate the query', () => {
  const router = require('../routes/admin');
  const paths = ['/reports/impact', '/reports/impact.csv', '/reports/impact.pdf'];
  for (const path of paths) {
    const layer = router.stack.find((l) => l.route && l.route.path === path);
    assert.ok(layer, `missing route ${path}`);
    assert.ok(layer.route.methods.get, `${path} should be GET`);
    const names = layer.route.stack.map((s) => s.name);
    assert.ok(names.includes('isAuthenticated'), `${path} needs isAuthenticated`);
    assert.ok(names.includes('requireRoleMiddleware'), `${path} needs a role guard`);
  }
});

test('a volunteer is refused the impact report', async () => {
  const router = require('../routes/admin');
  const layer = router.stack.find((l) => l.route && l.route.path === '/reports/impact.pdf');
  const guard = layer.route.stack.find((s) => s.name === 'requireRoleMiddleware').handle;

  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql)) return [[{ user_id: 5, role: 'volunteer' }]];
    return [[]];
  });
  const res = makeRes();
  let nextCalled = false;
  await guard({ session: { userId: 5, role: 'volunteer' } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql)) return [[{ user_id: 6, role: 'staff' }]];
    return [[]];
  });
  const staffRes = makeRes();
  let staffNext = false;
  await guard({ session: { userId: 6, role: 'staff' } }, staffRes, () => { staffNext = true; });
  assert.equal(staffNext, true);
});
