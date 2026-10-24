'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'frontend');
const SKIP = new Set(['kiosk.html']);

const TAGS = [
  '<link rel="manifest" href="/public/manifest.webmanifest" />',
  '<link rel="icon" type="image/png" sizes="32x32" href="/public/icons/favicon-32.png" />',
  '<link rel="apple-touch-icon" href="/public/icons/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-title" content="ShelterLink" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
];

const THEME = '<meta name="theme-color" content="#0f766e" />';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function hasTag(html, tag) {
  const rel = tag.match(/rel="([^"]+)"/);
  const name = tag.match(/name="([^"]+)"/);
  if (rel) {
    const href = tag.match(/href="([^"]+)"/);
    if (rel[1] === 'icon') return /rel="icon"/i.test(html) && /favicon-32\.png/.test(html);
    if (rel[1] === 'apple-touch-icon') return /rel="apple-touch-icon"/i.test(html);
    if (rel[1] === 'manifest') return /rel="manifest"/i.test(html);
    return html.includes(tag);
  }
  if (name) {
    const re = new RegExp(`<meta[^>]*name="${name[1]}"`, 'i');
    return re.test(html);
  }
  return html.includes(tag);
}

function transform(html) {
  let next = html;
  if (!/<meta[^>]*name="theme-color"/i.test(next)) {
    if (/<meta name="viewport"[^>]*>/i.test(next)) {
      next = next.replace(/(<meta name="viewport"[^>]*>)/i, `$1\n    ${THEME}`);
    } else {
      next = next.replace(/<head>/i, `<head>\n    ${THEME}`);
    }
  }
  const insertAfter = /(<meta[^>]*name="theme-color"[^>]*>)/i;
  const toAdd = TAGS.filter((tag) => !hasTag(next, tag));
  if (!toAdd.length) return next;
  const block = toAdd.map((tag) => `    ${tag}`).join('\n');
  if (insertAfter.test(next)) {
    return next.replace(insertAfter, `$1\n${block}`);
  }
  return next.replace(/<head>/i, `<head>\n${block}`);
}

function main() {
  const files = walk(ROOT).filter((file) => !SKIP.has(path.basename(file)));
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const next = transform(html);
    if (next !== html) fs.writeFileSync(file, next);
  }
}

main();
