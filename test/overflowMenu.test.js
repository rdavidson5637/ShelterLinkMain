'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function classTokens(el) {
  return String(el.className || '')
    .split(/\s+/)
    .filter(Boolean);
}

function matches(el, sel) {
  if (!el || sel == null) return false;
  if (sel.startsWith('.')) return classTokens(el).includes(sel.slice(1));
  const attr = sel.match(/^\[([^=]+)="([^"]+)"\]$/);
  if (attr) return el.getAttribute(attr[1]) === attr[2];
  return false;
}

function installDom() {
  const docListeners = [];
  const winListeners = [];

  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this.style = {};
      this.className = '';
      this.hidden = false;
      this.textContent = '';
      this.parent = null;
      this.listeners = {};
    }

    setAttribute(name, value) {
      this.attrs[name] = String(value);
    }

    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }

    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }

    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }

    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    }

    querySelectorAll(sel) {
      const found = [];
      const walk = (node) => {
        if (matches(node, sel)) found.push(node);
        node.children.forEach(walk);
      };
      this.children.forEach(walk);
      return found;
    }

    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }

    contains(node) {
      if (node === this) return true;
      return this.children.some((child) => child.contains(node));
    }

    closest(sel) {
      let node = this;
      while (node) {
        if (matches(node, sel)) return node;
        node = node.parent;
      }
      return null;
    }

    focus() {
      document.activeElement = this;
    }

    getBoundingClientRect() {
      return { top: 200, bottom: 244, left: 80, right: 200, width: 120, height: 44 };
    }

    get offsetHeight() {
      return 88;
    }

    get offsetWidth() {
      return 160;
    }
  }

  const body = new El('body');
  const document = {
    body,
    activeElement: null,
    addEventListener(type, fn, capture) {
      docListeners.push({ type, fn, capture: capture === true });
    },
    createElement(tag) {
      return new El(tag);
    },
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
  };
  const window = {
    innerHeight: 800,
    innerWidth: 1280,
    addEventListener(type, fn, capture) {
      winListeners.push({ type, fn, capture: capture === true });
    },
  };

  global.document = document;
  global.window = window;
  return { body, docListeners, winListeners };
}

function scrollFrom(target, docListeners) {
  const path = [];
  let node = target;
  while (node) {
    path.push(node);
    node = node.parent;
  }
  path.reverse();
  for (const record of docListeners) {
    if (record.type === 'scroll' && record.capture) record.fn({ target });
  }
  return path.length > 0;
}

test('an open row menu closes when an inner table scrolls, and when the window resizes', async () => {
  const { body, docListeners, winListeners } = installDom();
  const { createOverflowMenu } = await import('../frontend/js/components/overflowMenu.js');
  const menu = createOverflowMenu({
    items: [{ label: 'Reject', destructive: true }],
  });
  body.appendChild(menu);

  const table = body.querySelector('.overflow-menu');
  const scroller = {
    parent: table,
    tagName: 'div',
    children: [],
    contains() {
      return false;
    },
  };
  const button = menu.querySelector('.overflow-menu-toggle');
  const panel = menu.querySelector('.overflow-menu-panel');

  button.listeners.click.forEach((fn) => fn({ stopPropagation() {}, target: button }));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.hidden, false);

  const scrollListener = docListeners.find((record) => record.type === 'scroll');
  assert.equal(scrollListener.capture, true);
  const pageScroll = winListeners.find((record) => record.type === 'scroll');
  assert.equal(pageScroll.capture, true);
  scrollFrom(scroller, docListeners);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.hidden, true);

  button.listeners.click.forEach((fn) => fn({ stopPropagation() {}, target: button }));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  pageScroll.fn();
  assert.equal(button.getAttribute('aria-expanded'), 'false');

  button.listeners.click.forEach((fn) => fn({ stopPropagation() {}, target: button }));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const resizeListener = winListeners.find((record) => record.type === 'resize');
  assert.ok(resizeListener);
  resizeListener.fn();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.hidden, true);
});
