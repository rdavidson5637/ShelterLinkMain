'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { specifiers, applyPreloads, run, FONT_PRELOADS } = require('../scripts/gen-preloads');

test('import walker reads static imports and skips comments', () => {
  const source = `
    import { a } from './a.js';
    import def from "../b.js";
    import './side.js';
    export { c } from './c.js';
    // import './nope.js';
    /* import './also-nope.js'; */
    import {
      d
    } from './d.js';
  `;
  assert.deepEqual(specifiers(source), ['./a.js', '../b.js', './side.js', './c.js', './d.js']);
});

test('preload block lists the two body fonts and not the bold cut', () => {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Example</title>
  </head>
  <body>
    <script type="module" src="/js/brandCache.js"></script>
  </body>
</html>
`;
  const next = applyPreloads(html);
  assert.match(next, /<!-- preload:start -->/);
  assert.match(next, /<!-- preload:end -->/);
  for (const href of FONT_PRELOADS) {
    assert.match(next, new RegExp(`rel="preload" href="${href}" as="font" type="font/woff2" crossorigin`));
  }
  assert.doesNotMatch(next, /atkinson-hyperlegible-next-700/);
  assert.match(next, /rel="modulepreload" href="\/js\/brandCache\.js"/);
  assert.equal(applyPreloads(next), next);
});

test('checked-in preload tags match the current import graph', () => {
  const stale = run({ check: true });
  assert.deepEqual(stale, []);
});
