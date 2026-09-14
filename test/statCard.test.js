'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.textContent = '';
    this.attrs = {};
  }

  append(...nodes) {
    this.children.push(...nodes);
    return this;
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  querySelectorAll(selector) {
    if (selector === '.stat-number') {
      return this.children.flatMap((child) => collect(child, (el) => el.className === 'stat-number'));
    }
    if (selector === '.badge') {
      return this.children.flatMap((child) => collect(child, (el) => /\bbadge\b/.test(el.className)));
    }
    return [];
  }
}

function collect(el, pred) {
  const out = pred(el) ? [el] : [];
  for (const child of el.children || []) {
    if (child && typeof child === 'object') out.push(...collect(child, pred));
  }
  return out;
}

test('pending KPI card shows the count once, even if a badge slot exists', async () => {
  global.document = {
    createElement: (tag) => new FakeEl(tag),
  };

  const { createStatCard } = await import('../frontend/js/components/statCard.js');
  const card = createStatCard({
    label: 'Pending Applications',
    valueId: 'pendingApplications',
    value: '2',
    badgeId: 'pendingBadge',
  });

  const numbers = collect(card, (el) => el.className === 'stat-number');
  assert.equal(numbers.length, 1);
  assert.equal(numbers[0].textContent, '2');
  assert.equal(numbers[0].id, 'pendingApplications');

  const badges = collect(card, (el) => el.id === 'pendingBadge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].hidden, true);
  assert.equal(badges[0].textContent, '');
});
