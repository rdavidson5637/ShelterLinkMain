'use strict';

/**
 * Funder impact report (SL-NOW-04).
 *
 * Aggregate figures for grant bids and trustee papers, for one shelter and a
 * date range. Every number comes straight from an existing column:
 *
 *   volunteer_hours (approved = 1, date in range)
 *     - approved hours              SUM(hours)
 *     - hours verified by check-in  SUM(hours) WHERE verified_by_checkin = 1
 *     - volunteers                  COUNT(DISTINCT user_id)
 *     - shifts covered              COUNT(DISTINCT opportunity_id)
 *   animal_activity (logged_at in range)
 *     - walks logged                COUNT(*) WHERE activity_type = 'walk'
 *     - animals helped              COUNT(DISTINCT animal_id), any activity type
 *     - entries per activity_type
 *
 * No names, emails or other personal data appear in the report. Tenancy is
 * enforced by row-level security through the shelter-bound pool.
 */

const { pool } = require('../config/database');
const { convertToCSV } = require('../utils/csvExport');
const { buildPdf } = require('../utils/simplePdf');
const { currentShelterName } = require('../utils/shelterBrand');
const { todayIso } = require('../utils/shelterTime');

const ACTIVITY_TYPES = ['walk', 'feed', 'socialise', 'clean', 'medical', 'transport', 'other'];
const ACTIVITY_LABELS = {
  walk: 'Walks',
  feed: 'Feeds',
  socialise: 'Socialising',
  clean: 'Cleaning',
  medical: 'Medical',
  transport: 'Transport',
  other: 'Other',
};
const MAX_RANGE_DAYS = 366 * 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/**
 * Validate the requested period. Both dates are required so a report always
 * states exactly which period it covers.
 */
function parseRange(query = {}) {
  const { startDate, endDate } = query;
  if (!startDate || !endDate) {
    return { error: 'Choose a start date and an end date.' };
  }
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) {
    return { error: 'Dates must be real dates in YYYY-MM-DD format.' };
  }
  if (start > end) {
    return { error: 'The start date must be on or before the end date.' };
  }
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) {
    return { error: 'Choose a period of five years or less.' };
  }
  return { startDate, endDate };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundHours(value) {
  return Math.round(num(value) * 100) / 100;
}

async function fetchImpactReport({ startDate, endDate }) {
  const [hoursRows] = await pool.execute(
    `
      SELECT
        COALESCE(SUM(hours), 0) AS approved_hours,
        COALESCE(SUM(CASE WHEN verified_by_checkin = 1 THEN hours ELSE 0 END), 0) AS checkin_hours,
        COUNT(DISTINCT user_id) AS volunteers,
        COUNT(DISTINCT opportunity_id) AS shifts
      FROM volunteer_hours
      WHERE approved = 1
        AND date >= ?::date
        AND date <= ?::date
    `,
    [startDate, endDate]
  );

  const [monthRows] = await pool.execute(
    `
      SELECT
        TO_CHAR(date, 'YYYY-MM') AS month,
        COALESCE(SUM(hours), 0) AS hours,
        COUNT(DISTINCT user_id) AS volunteers
      FROM volunteer_hours
      WHERE approved = 1
        AND date >= ?::date
        AND date <= ?::date
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY month
    `,
    [startDate, endDate]
  );

  const [activityRows] = await pool.execute(
    `
      SELECT
        activity_type,
        COUNT(*) AS entries,
        COUNT(DISTINCT animal_id) AS animals
      FROM animal_activity
      WHERE logged_at >= ?::date
        AND logged_at < (?::date + 1)
      GROUP BY activity_type
    `,
    [startDate, endDate]
  );

  const [animalRows] = await pool.execute(
    `
      SELECT COUNT(DISTINCT animal_id) AS animals_helped
      FROM animal_activity
      WHERE logged_at >= ?::date
        AND logged_at < (?::date + 1)
    `,
    [startDate, endDate]
  );

  const hours = hoursRows[0] || {};
  const byType = new Map(activityRows.map((r) => [String(r.activity_type), r]));
  const activity = ACTIVITY_TYPES.map((type) => ({
    type,
    label: ACTIVITY_LABELS[type],
    entries: num(byType.get(type)?.entries),
    animals: num(byType.get(type)?.animals),
  }));

  return {
    startDate,
    endDate,
    summary: {
      approvedHours: roundHours(hours.approved_hours),
      checkinVerifiedHours: roundHours(hours.checkin_hours),
      volunteers: num(hours.volunteers),
      shifts: num(hours.shifts),
      walks: activity.find((a) => a.type === 'walk').entries,
      animalsHelped: num(animalRows[0]?.animals_helped),
    },
    activity,
    months: monthRows.map((r) => ({
      month: String(r.month),
      hours: roundHours(r.hours),
      volunteers: num(r.volunteers),
    })),
  };
}

const SUMMARY_LINES = [
  ['approvedHours', 'Approved volunteer hours'],
  ['checkinVerifiedHours', 'Of which verified by shift check-in'],
  ['volunteers', 'Volunteers who logged approved hours'],
  ['shifts', 'Shifts with approved hours'],
  ['walks', 'Animal walks logged'],
  ['animalsHelped', 'Animals helped (any logged activity)'],
];

function formatHours(value) {
  return num(value).toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

function formatNumber(value) {
  return num(value).toLocaleString('en-GB');
}

function formatLongDate(iso) {
  const dt = parseIsoDate(iso);
  if (!dt) return iso;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatMonth(ym) {
  const dt = parseIsoDate(`${ym}-01`);
  if (!dt) return ym;
  return dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function reportToCsv(report, shelterName = '') {
  const rows = [
    { section: 'period', item: 'Shelter', value: shelterName },
    { section: 'period', item: 'Start date', value: report.startDate },
    { section: 'period', item: 'End date', value: report.endDate },
    ...SUMMARY_LINES.map(([key, label]) => ({ section: 'summary', item: label, value: report.summary[key] })),
    ...report.activity.map((a) => ({ section: 'animal activity entries', item: a.label, value: a.entries })),
    ...report.months.map((m) => ({ section: 'approved hours by month', item: m.month, value: m.hours })),
  ];
  return convertToCSV(rows, ['section', 'item', 'value']);
}

function reportToPdf(report, shelterName = '', generatedOn = '') {
  const heading = shelterName ? `${shelterName} - volunteer impact` : 'Volunteer impact report';
  const lines = [
    { text: heading, size: 20, bold: true },
    { text: `${formatLongDate(report.startDate)} to ${formatLongDate(report.endDate)}`, size: 12, gap: 4 },
    { text: 'Summary', size: 14, bold: true, gap: 20 },
  ];

  SUMMARY_LINES.forEach(([key, label]) => {
    const isHours = key === 'approvedHours' || key === 'checkinVerifiedHours';
    const value = isHours ? formatHours(report.summary[key]) : formatNumber(report.summary[key]);
    lines.push({ text: `${label}: ${value}`, size: 11, gap: 2 });
  });

  lines.push({ text: 'Animal care logged by volunteers', size: 14, bold: true, gap: 18 });
  const logged = report.activity.filter((a) => a.entries > 0);
  if (logged.length) {
    logged.forEach((a) => {
      const animals = a.animals === 1 ? '1 animal' : `${formatNumber(a.animals)} animals`;
      lines.push({ text: `${a.label}: ${formatNumber(a.entries)} entries, ${animals}`, size: 11, gap: 2 });
    });
  } else {
    lines.push({ text: 'No animal activity was logged in this period.', size: 11, gap: 2 });
  }

  lines.push({ text: 'Approved hours by month', size: 14, bold: true, gap: 18 });
  if (report.months.length) {
    report.months.forEach((m) => {
      const people = m.volunteers === 1 ? '1 volunteer' : `${formatNumber(m.volunteers)} volunteers`;
      lines.push({ text: `${formatMonth(m.month)}: ${formatHours(m.hours)} hours, ${people}`, size: 11, gap: 2 });
    });
  } else {
    lines.push({ text: 'No approved hours were recorded in this period.', size: 11, gap: 2 });
  }

  lines.push({ text: 'How these figures are counted', size: 12, bold: true, gap: 22 });
  [
    'Hours are volunteer hour records approved by staff, dated within the period.',
    'Animals helped counts each animal once if any walk, feed, socialising, cleaning, medical, transport or other activity was logged for it in the period.',
    'Figures only include what volunteers and staff recorded in ShelterLink.',
  ].forEach((text) => lines.push({ text, size: 9, gap: 2 }));

  if (generatedOn) {
    lines.push({ text: `Generated by ShelterLink on ${formatLongDate(generatedOn)}.`, size: 9, gap: 10 });
  }

  return buildPdf({ title: heading, lines });
}

function fileStem(range) {
  return `impact-report-${range.startDate}-to-${range.endDate}`;
}

async function loadReport(req, res) {
  const range = parseRange(req.query || {});
  if (range.error) {
    res.status(400).json({ error: range.error });
    return null;
  }
  return fetchImpactReport(range);
}

async function getImpactReport(req, res) {
  try {
    const report = await loadReport(req, res);
    if (!report) return undefined;
    return res.status(200).json(report);
  } catch (error) {
    console.error('[ImpactReport] getImpactReport error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getImpactReportCsv(req, res) {
  try {
    const report = await loadReport(req, res);
    if (!report) return undefined;
    const csv = reportToCsv(report, await currentShelterName());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem(report)}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[ImpactReport] getImpactReportCsv error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getImpactReportPdf(req, res) {
  try {
    const report = await loadReport(req, res);
    if (!report) return undefined;
    const pdf = reportToPdf(report, await currentShelterName(), todayIso());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem(report)}.pdf"`);
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('[ImpactReport] getImpactReportPdf error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  parseRange,
  fetchImpactReport,
  reportToCsv,
  reportToPdf,
  getImpactReport,
  getImpactReportCsv,
  getImpactReportPdf,
};
