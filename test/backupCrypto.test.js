'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { encryptBuffer, decryptBuffer } = require('../utils/backupCrypto');

test('backup encryption round-trips and rejects a short key or a tampered file', () => {
  const key = 'correct horse battery';
  const plain = Buffer.from('INSERT INTO users VALUES (1);');
  const blob = encryptBuffer(plain, key);
  assert.notStrictEqual(blob.toString('utf8').includes('INSERT INTO users'), true);
  assert.deepStrictEqual(decryptBuffer(blob, key), plain);
  assert.throws(() => encryptBuffer(plain, 'short'), /16 characters/);
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptBuffer(tampered, key));
});
