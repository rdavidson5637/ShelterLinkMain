'use strict';

const crypto = require('crypto');
const fs = require('fs');

const MAGIC = Buffer.from('SLBK');
const VERSION = 1;
const HEADER_LEN = 4 + 1 + 16 + 12;
const TAG_LEN = 16;

function requirePassphrase(passphrase) {
  const value = String(passphrase || '');
  if (value.length < 16) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be at least 16 characters');
  }
  return value;
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(requirePassphrase(passphrase), salt, 32);
}

function encryptBuffer(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, ciphertext]);
}

function decryptBuffer(blob, passphrase) {
  if (!Buffer.isBuffer(blob) || blob.length < HEADER_LEN + TAG_LEN) {
    throw new Error('Backup file is too short');
  }
  if (!blob.subarray(0, 4).equals(MAGIC) || blob[4] !== VERSION) {
    throw new Error('Backup file is not an encrypted ShelterLink dump');
  }
  const salt = blob.subarray(5, 21);
  const iv = blob.subarray(21, 33);
  const tag = blob.subarray(33, 33 + TAG_LEN);
  const ciphertext = blob.subarray(33 + TAG_LEN);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptFile(srcPath, destPath, passphrase) {
  const plain = fs.readFileSync(srcPath);
  fs.writeFileSync(destPath, encryptBuffer(plain, passphrase));
}

function decryptFile(srcPath, destPath, passphrase) {
  const blob = fs.readFileSync(srcPath);
  fs.writeFileSync(destPath, decryptBuffer(blob, passphrase));
}

module.exports = {
  encryptBuffer,
  decryptBuffer,
  encryptFile,
  decryptFile,
  requirePassphrase,
};
