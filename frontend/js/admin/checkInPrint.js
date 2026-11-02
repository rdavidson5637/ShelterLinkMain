import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Check-in print page. No script tag: the opener calls print() after close,
 * because the new window inherits the page CSP and would block an inline script.
 */
export function checkInPrintDocument({ title, when, code }) {
  return `<!DOCTYPE html><html><head><title>Check-in code</title>
          <style>body{font-family:system-ui,sans-serif;text-align:center;padding:3rem}
          h1{font-size:1.25rem}code{font-size:3rem;letter-spacing:0.2em}</style></head><body>
          <h1>${escapeHtml(title || 'Shift')}</h1>
          <p>${escapeHtml(when || '')}</p>
          <p>Check-in code</p>
          <code>${escapeHtml(code || '')}</code>
          </body></html>`;
}

export function writeCheckInPrint(win, details) {
  if (!win || !win.document || typeof win.print !== 'function') return false;
  const html = checkInPrintDocument(details);
  win.document.write(html);
  win.document.close();
  win.print();
  return true;
}
