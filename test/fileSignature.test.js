'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sniffDocument, sniffImage, canonicalMime } = require('../utils/fileSignature');

test('sniffDocument recognises PDF, JPEG, and PNG signatures', () => {
  assert.strictEqual(sniffDocument(Buffer.from('%PDF-1.4\n')), 'application/pdf');
  assert.strictEqual(sniffDocument(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 'image/jpeg');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.strictEqual(sniffDocument(png), 'image/png');
  assert.strictEqual(sniffDocument(Buffer.from('MZ executable')), null);
  assert.strictEqual(sniffImage(Buffer.from('%PDF-1.4')), null);
  assert.strictEqual(canonicalMime('image/jpg; charset=binary'), 'image/jpeg');
});
