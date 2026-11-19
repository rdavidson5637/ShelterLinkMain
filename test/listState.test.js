'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.attrs = {};
    this.listeners = {};
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') this.textContent += node;
      else this.children.push(node);
    }
    return this;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return this.attrs[name];
  }

  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }

  click() {
    for (const fn of this.listeners.click || []) fn();
  }

  querySelector(selector) {
    if (selector === 'a') {
      return collect(this, (el) => el.tagName === 'A')[0] || null;
    }
    if (selector === 'button') {
      return collect(this, (el) => el.tagName === 'BUTTON')[0] || null;
    }
    return null;
  }
}

function collect(el, pred) {
  const out = pred(el) ? [el] : [];
  for (const child of el.children || []) {
    if (child && typeof child === 'object') out.push(...collect(child, pred));
  }
  return out;
}

function textOf(el) {
  let text = el.textContent || '';
  for (const child of el.children || []) {
    if (child && typeof child === 'object') text += textOf(child);
  }
  return text;
}

test('renderEmptyState and renderErrorState build recoverable panels', async () => {
  global.document = {
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (value) => String(value),
  };

  const { renderEmptyState, renderErrorState } = await import('../frontend/js/utils/listState.js');

  const empty = renderEmptyState({
    title: 'No open shifts',
    body: 'Check back soon.',
    actionHref: '/',
    actionLabel: 'Back to home',
  });
  assert.equal(empty.className, 'empty-state');
  assert.equal(empty.getAttribute('role'), 'status');
  assert.match(textOf(empty), /No open shifts/);
  assert.equal(empty.querySelector('a')?.getAttribute('href'), '/');

  let clicks = 0;
  const error = renderErrorState({
    title: 'Could not load shifts',
    body: 'Check your connection.',
    onRetry: () => {
      clicks += 1;
    },
  });
  assert.equal(error.className, 'error-state');
  assert.equal(error.getAttribute('role'), 'alert');
  error.querySelector('button')?.click();
  assert.equal(clicks, 1);

  delete global.document;
});
