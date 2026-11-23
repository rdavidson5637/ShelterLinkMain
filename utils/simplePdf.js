'use strict';

/**
 * Minimal text-only PDF writer (PDF 1.4, A4, standard Helvetica fonts).
 *
 * Enough for one- or two-page reports without pulling in a PDF library.
 * Each line is { text, size?, bold?, gap? } where gap is extra space above
 * the line in points. Lines wrap at the page width and flow onto new pages.
 */

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

// Helvetica glyph widths (per 1000 em) for printable ASCII 32–126.
// Used only to wrap lines; unknown characters fall back to 556.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/**
 * Reduce text to characters the built-in WinAnsi Helvetica can show.
 * Common typographic characters are mapped; anything else becomes "?".
 */
function toPdfText(value) {
  return String(value == null ? '' : value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?');
}

function escapePdfString(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textWidth(text, size) {
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += HELVETICA_WIDTHS[code - 32] || 556;
  }
  // Bold is slightly wider; a 5% allowance keeps wrapped bold lines inside the margin.
  return (units / 1000) * size * 1.05;
}

function wrapLine(text, size, maxWidth) {
  if (textWidth(text, size) <= maxWidth) return [text];
  const words = text.split(' ');
  const out = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, size) > maxWidth) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

function layoutPages(lines) {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const pages = [[]];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    const size = Number(line.size) || 11;
    const leading = size * 1.35;
    const gap = Number(line.gap) || 0;
    const wrapped = wrapLine(toPdfText(line.text), size, maxWidth);

    y -= gap;
    wrapped.forEach((piece) => {
      if (y - leading < MARGIN) {
        pages.push([]);
        y = PAGE_HEIGHT - MARGIN;
      }
      y -= leading;
      pages[pages.length - 1].push({ text: piece, size, bold: Boolean(line.bold), y });
    });
  }
  return pages;
}

function pageStream(items) {
  return items
    .map((item) => {
      const font = item.bold ? 'F2' : 'F1';
      return `BT /${font} ${item.size} Tf ${MARGIN} ${item.y.toFixed(2)} Td (${escapePdfString(item.text)}) Tj ET`;
    })
    .join('\n');
}

/**
 * Build a PDF document as a Buffer.
 * @param {{ title?: string, lines: Array<{text:string,size?:number,bold?:boolean,gap?:number}> }} doc
 */
function buildPdf({ title = '', lines = [] } = {}) {
  const pages = layoutPages(lines);

  // Object numbers: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info,
  // then for each page: page object + content stream.
  const objects = [];
  const pageObjectIds = pages.map((_, i) => 6 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title (${escapePdfString(toPdfText(title))}) /Producer (ShelterLink) >>`;

  pages.forEach((items, i) => {
    const pageId = pageObjectIds[i];
    const contentId = pageId + 1;
    const stream = pageStream(items);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, 'latin1');
  const count = objects.length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}

module.exports = { buildPdf, toPdfText, escapePdfString };
