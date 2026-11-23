'use strict';

/**
 * Object storage for uploads (volunteer documents, animal photos).
 *
 * Default: Postgres bytea (existing behaviour). When all OBJECT_STORAGE_*
 * settings are present, new uploads go to an S3-compatible bucket instead,
 * and the database keeps only metadata plus a storage_key.
 *
 * Object storage is optional. Incomplete config falls back to the database
 * so local/dev and current production keep working without new secrets.
 * Do not invent keys — Ryan sets them on the host when a free-tier bucket
 * (e.g. Cloudflare R2 or Supabase Storage S3) is ready.
 */

const crypto = require('crypto');
const { createS3Client } = require('./s3');

const REQUIRED_ENV = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
];

let cached = null;
let cachedKey = null;

function readConfig(env = process.env) {
  const values = {};
  let missing = 0;
  for (const name of REQUIRED_ENV) {
    const raw = env[name];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    values[name] = trimmed;
    if (!trimmed) missing += 1;
  }
  if (missing === REQUIRED_ENV.length) {
    return { mode: 'db', reason: 'not_configured' };
  }
  if (missing > 0) {
    return { mode: 'db', reason: 'incomplete_config' };
  }
  const region = (env.OBJECT_STORAGE_REGION || 'auto').trim() || 'auto';
  const forcePathStyle = String(env.OBJECT_STORAGE_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false';
  return {
    mode: 's3',
    endpoint: values.OBJECT_STORAGE_ENDPOINT,
    bucket: values.OBJECT_STORAGE_BUCKET,
    accessKeyId: values.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: values.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    region,
    forcePathStyle,
  };
}

function configCacheKey(config) {
  if (config.mode !== 's3') return `db:${config.reason || ''}`;
  return [
    's3',
    config.endpoint,
    config.bucket,
    config.region,
    config.forcePathStyle ? 'path' : 'virtual',
    config.accessKeyId,
  ].join('|');
}

function getObjectStorage(env = process.env) {
  const config = readConfig(env);
  const key = configCacheKey(config);
  if (cached && cachedKey === key) return cached;

  if (config.mode !== 's3') {
    cached = {
      name: 'db',
      isConfigured: () => false,
      reason: config.reason,
      async put() {
        throw new Error('Object storage is not configured');
      },
      async get() {
        return null;
      },
      async remove() {
        /* no-op when storage is off */
      },
    };
    cachedKey = key;
    return cached;
  }

  const client = createS3Client(config);
  cached = {
    name: 's3',
    isConfigured: () => true,
    reason: null,
    put: client.put,
    get: client.get,
    remove: client.remove,
  };
  cachedKey = key;
  return cached;
}

/** Reset cached client (tests). */
function resetObjectStorageCache() {
  cached = null;
  cachedKey = null;
}

/**
 * Opaque object key. Never use the original file name as the key.
 * @param {'documents'|'animal-photos'} kind
 * @param {string|number} ownerId
 * @param {string} [ext] including the leading dot, or empty
 */
function buildObjectKey(kind, ownerId, ext = '') {
  const safeKind = kind === 'animal-photos' ? 'animal-photos' : 'documents';
  const id = String(ownerId || '0').replace(/[^\w-]/g, '').slice(0, 32) || '0';
  const safeExt = /^\.\w{1,8}$/.test(ext) ? ext.toLowerCase() : '';
  const nonce = crypto.randomBytes(16).toString('hex');
  return `${safeKind}/${id}/${nonce}${safeExt}`;
}

function isObjectStorageConfigured(env = process.env) {
  return getObjectStorage(env).isConfigured();
}

module.exports = {
  REQUIRED_ENV,
  readConfig,
  getObjectStorage,
  resetObjectStorageCache,
  buildObjectKey,
  isObjectStorageConfigured,
};
