'use strict';

/**
 * Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s step) for
 * staff and admin two-factor sign-in. No third-party dependency: the
 * algorithm is small and node:crypto has everything it needs.
 *
 * Secrets are stored encrypted (AES-256-GCM). The key is derived with HKDF
 * from TOTP_ENCRYPTION_KEY, or SESSION_SECRET when that is not set, so a
 * database dump alone does not give out working authenticator seeds.
 */

const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const DRIFT_STEPS = 1;
const SECRET_BYTES = 20;
const RECOVERY_CODE_COUNT = 8;
const ISSUER = 'ShelterLink';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

function hotp(secretB32, counter) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

function counterAt(timeMs = Date.now()) {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

function generateCode(secretB32, timeMs = Date.now()) {
  return hotp(secretB32, counterAt(timeMs));
}

function normaliseCode(code) {
  return String(code == null ? '' : code).replace(/\s+/g, '');
}

/**
 * Check a 6-digit code within one step either side of now.
 * Returns the matched counter, or null. A counter at or below
 * `lastCounter` is refused so a code cannot be replayed.
 */
function verifyCode(secretB32, code, { timeMs = Date.now(), lastCounter = null } = {}) {
  const given = normaliseCode(code);
  if (!/^\d{6}$/.test(given)) return null;
  const now = counterAt(timeMs);
  const floor = lastCounter == null ? -Infinity : Number(lastCounter);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta += 1) {
    const counter = now + delta;
    if (counter <= floor) continue;
    const expected = hotp(secretB32, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return counter;
  }
  return null;
}

function otpauthUri(secretB32, accountName) {
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ─── Encryption at rest ──────────────────────────────────────────────────────

function encryptionKey() {
  const material = process.env.TOTP_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!material) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error('Two-factor encryption key is not configured');
      err.status = 500;
      throw err;
    }
    return Buffer.from(
      crypto.hkdfSync('sha256', 'shelterlink-dev-only', 'shelterlink-totp', 'totp-secret-v1', 32)
    );
  }
  return Buffer.from(crypto.hkdfSync('sha256', material, 'shelterlink-totp', 'totp-secret-v1', 32));
}

function encryptSecret(secretB32) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(secretB32), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unreadable two-factor secret');
  const [, iv, tag, enc] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}

// ─── Recovery codes ──────────────────────────────────────────────────────────

function normaliseRecoveryCode(code) {
  return String(code == null ? '' : code).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

/** Returns { codes: [shown once], hashes: [stored] }. */
function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex');
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Returns the remaining hashes if `code` matched one, otherwise null. */
function consumeRecoveryCode(storedJson, code) {
  let hashes;
  try {
    hashes = JSON.parse(storedJson || '[]');
  } catch (_) {
    return null;
  }
  if (!Array.isArray(hashes) || normaliseRecoveryCode(code).length !== 10) return null;
  const want = Buffer.from(hashRecoveryCode(code));
  const idx = hashes.findIndex(
    (h) => typeof h === 'string' && h.length === want.length && crypto.timingSafeEqual(Buffer.from(h), want)
  );
  if (idx === -1) return null;
  return hashes.filter((_, i) => i !== idx);
}

module.exports = {
  STEP_SECONDS,
  DIGITS,
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  counterAt,
  generateCode,
  verifyCode,
  otpauthUri,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  consumeRecoveryCode,
  hashRecoveryCode,
};
