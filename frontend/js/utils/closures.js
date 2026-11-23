/**
 * Shelter closure dates on the client (SL-LATER-30). Dates are shelter-local
 * 'YYYY-MM-DD' strings from the API. Pure functions for unit tests and the
 * public board, volunteer browse and admin closures page.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

function parts(day) {
  const m = ISO.exec(String(day || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), weekday: d.getUTCDay() };
}

export function formatClosureDay(day, { withYear = true } = {}) {
  const p = parts(day);
  if (!p) return String(day || '');
  const base = `${DAYS[p.weekday]} ${p.date} ${MONTHS[p.month]}`;
  return withYear ? `${base} ${p.year}` : base;
}

/** "Thu 25 Dec 2026" or "Thu 24 Dec to Sat 26 Dec 2026". */
export function formatClosureRange(closure) {
  if (!closure) return '';
  const start = String(closure.starts_on || '').slice(0, 10);
  const end = String(closure.ends_on || start).slice(0, 10);
  if (!end || end === start) return formatClosureDay(start);
  const a = parts(start);
  const b = parts(end);
  const sameYear = a && b && a.year === b.year;
  return `${formatClosureDay(start, { withYear: !sameYear })} to ${formatClosureDay(end)}`;
}

export function dayCount(closure) {
  const a = Date.parse(`${String(closure?.starts_on || '').slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(closure?.ends_on || closure?.starts_on || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export function closureOnDay(closures, value) {
  const day = String(value || '').slice(0, 10);
  if (!ISO.test(day)) return null;
  return (Array.isArray(closures) ? closures : []).find(
    (c) => String(c.starts_on).slice(0, 10) <= day && day <= String(c.ends_on || c.starts_on).slice(0, 10)
  ) || null;
}

/**
 * Ruled list of upcoming closed days: one <li> per closure, date first,
 * then the reason. Returns null when there is nothing to show.
 */
export function renderClosedDaysList(closures, doc = document) {
  const list = Array.isArray(closures) ? closures : [];
  if (!list.length) return null;
  const section = doc.createElement('section');
  section.className = 'closed-days';
  section.setAttribute('aria-labelledby', 'closedDaysHeading');
  const heading = doc.createElement('h2');
  heading.id = 'closedDaysHeading';
  heading.textContent = 'Closed days';
  const ul = doc.createElement('ul');
  ul.className = 'closed-days-list';
  list.forEach((c) => {
    const li = doc.createElement('li');
    const when = doc.createElement('strong');
    when.textContent = formatClosureRange(c);
    const status = doc.createElement('span');
    status.className = 'closed-days-status';
    status.textContent = 'Closed';
    const reason = doc.createElement('span');
    reason.className = 'closed-days-reason';
    reason.textContent = c.reason || '';
    li.append(when, status, reason);
    ul.appendChild(li);
  });
  section.append(heading, ul);
  return section;
}
