'use strict';

/**
 * Shared helpers for multipart email (HTML + plain text). SL-LATER-38.
 */

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Turn our email HTML into a readable plain-text alternative.
 * Handles paragraphs, lists, headings, line breaks, and links.
 */
function htmlToPlainText(html) {
  let s = String(html || '');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|tr|blockquote)>/gi, '\n\n');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n');
  s = s.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => {
      const label = String(inner)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
      if (!label) return String(href);
      if (label === href) return label;
      return `${label} (${href})`;
    }
  );
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function composeMailParts(subject, html, text) {
  const safeSubject = String(subject || '').trim();
  const htmlContent = String(html || '');
  if (!safeSubject) throw new Error('Email subject is required');
  if (!htmlContent.trim()) throw new Error('Email content is required');
  const plain = (text && String(text).trim()) || htmlToPlainText(htmlContent);
  if (!plain) throw new Error('Email content is required');
  return { subject: safeSubject, html: htmlContent, text: plain };
}

module.exports = {
  escapeHtml,
  htmlToPlainText,
  composeMailParts,
};
