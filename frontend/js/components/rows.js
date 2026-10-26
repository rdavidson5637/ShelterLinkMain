/**
 * Builders for the ruled-row list pattern in custom.css. Everything is made
 * with textContent, so data from the API is never parsed as HTML.
 */

import { parseShiftDate } from '../utils/dateFormat.js';

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Rota-board date block: weekday, day number, month. Decorative: the row's
 * detail line carries the full date for screen readers.
 */
export function createDateBlock(value) {
  const date = value instanceof Date ? value : parseShiftDate(value);
  const block = el('div', 'ruled-row-lead date-block');
  block.setAttribute('aria-hidden', 'true');
  if (!date) {
    block.appendChild(el('span', 'date-block-day', 'Any day'));
    return block;
  }
  block.append(
    el('span', 'date-block-day', WEEKDAY.format(date)),
    el('span', 'date-block-num', String(date.getDate())),
    el('span', 'date-block-day', MONTH.format(date))
  );
  return block;
}

/** Status label: dot plus word. tone is ok | pending | danger | brand | neutral. */
export function createStatusLabel(text, tone = 'neutral') {
  const span = el('span', 'status-label', text);
  span.dataset.tone = tone;
  return span;
}

/**
 * One ruled row.
 * @param {{ lead?: Node, title: string, titleHref?: string, details?: (string|Node)[],
 *           end?: Node[], tag?: string, needsYou?: boolean }} options
 */
export function createRuledRow({ lead, title, titleHref, details = [], end = [], tag = 'li', needsYou = false }) {
  const row = el(tag, needsYou ? 'ruled-row needs-you' : 'ruled-row');
  if (lead) row.appendChild(lead);

  const main = el('div', 'ruled-row-main');
  const titleEl = titleHref ? el('a', 'ruled-row-title', title) : el('strong', 'ruled-row-title', title);
  if (titleHref) titleEl.href = titleHref;
  main.appendChild(titleEl);
  details.filter((d) => d != null && d !== '').forEach((detail) => {
    const line = el('span', 'ruled-row-detail');
    if (typeof detail === 'string') line.textContent = detail;
    else line.appendChild(detail);
    main.appendChild(line);
  });
  row.appendChild(main);

  const endNodes = end.filter(Boolean);
  if (endNodes.length) {
    const endEl = el('div', 'ruled-row-end');
    endEl.append(...endNodes);
    row.appendChild(endEl);
  }
  return row;
}

/** Placeholder rows the same height as real ones. */
export function createSkeletonRows(count = 3, { lead = true } = {}) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const row = el('li', 'ruled-row is-loading');
    row.setAttribute('aria-hidden', 'true');
    if (lead) row.appendChild(el('span', 'ruled-row-lead skeleton skeleton-block'));
    const main = el('span', 'ruled-row-main');
    main.append(el('span', 'skeleton'), el('span', 'skeleton skeleton-detail'));
    row.appendChild(main);
    frag.appendChild(row);
  }
  return frag;
}

/** One plain sentence and, optionally, the next action. */
export function createEmptyState(sentence, action) {
  const wrap = el('div', 'empty-state');
  wrap.appendChild(el('p', null, sentence));
  if (action && action.href && action.label) {
    const p = el('p');
    const a = el('a', null, action.label);
    a.href = action.href;
    p.appendChild(a);
    wrap.appendChild(p);
  }
  return wrap;
}
