'use strict';

/**
 * Writes font preloads and modulepreload tags into each frontend HTML head.
 * Walks static import and export-from edges only. Classic scripts and
 * dynamic import() are not listed. Rerun after import graphs change.
 * Only the marker block is rewritten.
 *
 *   node scripts/gen-preloads.js
 *   node scripts/gen-preloads.js --check
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const START = '<!-- preload:start -->';
const END = '<!-- preload:end -->';
const FONT_PRELOADS = [
  '/public/fonts/atkinson-hyperlegible-next-400.woff2',
  '/public/fonts/young-serif-400.woff2',
];

function walkHtml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function specifiers(source) {
  const cleaned = String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  const found = [];
  const re = /\bimport\s*(?:[^'"]*?)\sfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(cleaned))) {
    found.push(match[1] || match[2] || match[3]);
  }
  return found;
}

function urlToFile(urlPath) {
  const clean = String(urlPath).split(/[?#]/)[0];
  if (!clean.startsWith('/')) return null;
  return path.normalize(path.join(FRONTEND, clean.slice(1)));
}

function fileToUrl(file) {
  const rel = path.relative(FRONTEND, file).split(path.sep).join('/');
  return `/${rel}`;
}

function resolveSpecifier(fromFile, spec) {
  if (spec.startsWith('.')) {
    return path.normalize(path.join(path.dirname(fromFile), spec));
  }
  if (spec.startsWith('/')) return urlToFile(spec);
  return null;
}

function entryModules(html) {
  const found = [];
  const re = /<script\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    if (!/\btype\s*=\s*['"]module['"]/i.test(attrs)) continue;
    const src = attrs.match(/\bsrc\s*=\s*['"]([^'"]+)['"]/i);
    if (src) found.push(src[1]);
  }
  return found;
}

function moduleGraph(html) {
  const urls = new Set();
  const queue = [];
  for (const src of entryModules(html)) {
    const file = src.startsWith('/')
      ? urlToFile(src)
      : null;
    if (file) queue.push(file);
  }
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(file) || !file.endsWith('.js')) continue;
    urls.add(fileToUrl(file));
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of specifiers(source)) {
      const next = resolveSpecifier(file, spec);
      if (next) queue.push(next);
    }
  }
  return [...urls].sort((a, b) => a.localeCompare(b));
}

function renderBlock(html, childIndent) {
  const lines = FONT_PRELOADS.map(
    (href) => `${childIndent}<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`,
  );
  for (const href of moduleGraph(html)) {
    lines.push(`${childIndent}<link rel="modulepreload" href="${href}">`);
  }
  return lines.join('\n');
}

function applyPreloads(html) {
  const headMatch = html.match(/\n([ \t]*)<\/head>/);
  if (!headMatch) return html;
  const indent = headMatch[1];
  const childIndent = `${indent}  `;
  const block = `${childIndent}${START}\n${renderBlock(html, childIndent)}\n${childIndent}${END}`;
  const region = new RegExp(`[ \\t]*${START}[\\s\\S]*?${END}`);
  if (region.test(html)) {
    return html.replace(region, block);
  }
  return html.replace(`\n${indent}</head>`, `\n${block}\n${indent}</head>`);
}

function run({ check = false, root = FRONTEND } = {}) {
  const files = walkHtml(root);
  const stale = [];
  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    const after = applyPreloads(before);
    if (before === after) continue;
    stale.push(path.relative(path.join(FRONTEND, '..'), file));
    if (!check) fs.writeFileSync(file, after);
  }
  return stale;
}

module.exports = {
  FONT_PRELOADS,
  START,
  END,
  specifiers,
  moduleGraph,
  applyPreloads,
  run,
};

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = run({ check });
  if (check && stale.length) {
    console.error(`Preload tags are stale in ${stale.length} file(s):`);
    for (const file of stale) console.error(`  ${file}`);
    console.error('Run: node scripts/gen-preloads.js');
    process.exit(1);
  }
  if (!check) {
    console.log(stale.length ? `Updated ${stale.length} page head(s).` : 'Preload tags already current.');
  }
}
