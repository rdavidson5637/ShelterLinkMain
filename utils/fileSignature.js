'use strict';

function canonicalMime(mime) {
  const value = String(mime || '').toLowerCase().split(';')[0].trim();
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg';
  return value;
}

function sniffDocument(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null;
  if (buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 4 && buffer.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

function sniffImage(buffer) {
  const detected = sniffDocument(buffer);
  if (detected === 'image/jpeg' || detected === 'image/png') return detected;
  return null;
}

module.exports = {
  canonicalMime,
  sniffDocument,
  sniffImage,
};
