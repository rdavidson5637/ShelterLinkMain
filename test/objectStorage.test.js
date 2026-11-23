'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  readConfig,
  getObjectStorage,
  resetObjectStorageCache,
  buildObjectKey,
  isObjectStorageConfigured,
  REQUIRED_ENV,
} = require('../utils/objectStorage');
const { authorize, sha256Hex, createS3Client } = require('../utils/objectStorage/s3');
const { collectProductionWarnings } = require('../utils/validateEnv');

function withEnv(vars, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetObjectStorageCache();
  const restore = () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetObjectStorageCache();
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

const FULL_S3_ENV = {
  OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test',
  OBJECT_STORAGE_BUCKET: 'shelterlink-uploads',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'AKIA_TEST',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret_test_value_not_real',
  OBJECT_STORAGE_REGION: 'auto',
  OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
};

test('readConfig defaults to db when unset', () => {
  withEnv(
    {
      OBJECT_STORAGE_ENDPOINT: undefined,
      OBJECT_STORAGE_BUCKET: undefined,
      OBJECT_STORAGE_ACCESS_KEY_ID: undefined,
      OBJECT_STORAGE_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      const config = readConfig(process.env);
      assert.equal(config.mode, 'db');
      assert.equal(config.reason, 'not_configured');
      assert.equal(isObjectStorageConfigured(), false);
      assert.equal(getObjectStorage().name, 'db');
    }
  );
});

test('readConfig stays on db when only some OBJECT_STORAGE_* vars are set', () => {
  withEnv(
    {
      OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test',
      OBJECT_STORAGE_BUCKET: 'bucket',
      OBJECT_STORAGE_ACCESS_KEY_ID: undefined,
      OBJECT_STORAGE_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      const config = readConfig(process.env);
      assert.equal(config.mode, 'db');
      assert.equal(config.reason, 'incomplete_config');
      assert.equal(isObjectStorageConfigured(), false);
    }
  );
});

test('readConfig enables s3 when all required vars are set', () => {
  withEnv(FULL_S3_ENV, () => {
    const config = readConfig(process.env);
    assert.equal(config.mode, 's3');
    assert.equal(config.bucket, 'shelterlink-uploads');
    assert.equal(isObjectStorageConfigured(), true);
    assert.equal(getObjectStorage().name, 's3');
  });
});

test('production warns only on incomplete OBJECT_STORAGE_* config', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      EMAIL_HOST: 'smtp.example.com',
      EMAIL_FROM: 'no-reply@example.com',
      WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
      WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
      SHELTER_EMERGENCY_PHONE: '028 0000 0000',
      BACKUP_ENCRYPTION_KEY: 'backup-key-at-least-16',
      SHELTER_TIMEZONE: 'Europe/London',
      OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test',
      OBJECT_STORAGE_BUCKET: undefined,
      OBJECT_STORAGE_ACCESS_KEY_ID: undefined,
      OBJECT_STORAGE_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      const warnings = collectProductionWarnings();
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /OBJECT_STORAGE_\* is partially set/);
      assert.doesNotMatch(warnings.join(' '), /secret_test|AKIA/);
    }
  );
});

test('buildObjectKey never embeds the original file name', () => {
  const key = buildObjectKey('documents', 42, '.pdf');
  assert.match(key, /^documents\/42\/[a-f0-9]{32}\.pdf$/);
  assert.doesNotMatch(key, /accessni|certificate|passport/i);

  const photo = buildObjectKey('animal-photos', 7, '.png');
  assert.match(photo, /^animal-photos\/7\/[a-f0-9]{32}\.png$/);

  const logo = buildObjectKey('shelter-logos', 3, '.jpg');
  assert.match(logo, /^shelter-logos\/3\/[a-f0-9]{32}\.jpg$/);
});

test('SigV4 authorize produces a stable credential scope and signature shape', () => {
  const url = new URL('https://storage.example.test/shelterlink-uploads/documents/1/abc.pdf');
  const body = Buffer.from('hello');
  const auth = authorize({
    method: 'PUT',
    url,
    headers: { 'content-type': 'application/pdf' },
    payload: body,
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'secret_test_value_not_real',
    region: 'auto',
  });
  assert.match(auth.authorization, /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\/\d{8}\/auto\/s3\/aws4_request/);
  assert.match(auth.authorization, /Signature=[a-f0-9]{64}/);
  assert.equal(auth.payloadHash, sha256Hex(body));
});

test('s3 client put/get/remove talk to fetch with signed headers', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const blobs = new Map();

  global.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const href = String(url);
    calls.push({ method, href, headers: opts.headers });
    if (method === 'PUT') {
      blobs.set(href, Buffer.from(opts.body));
      return { ok: true, status: 200, text: async () => '' };
    }
    if (method === 'GET') {
      const buf = blobs.get(href);
      if (!buf) {
        return {
          ok: false,
          status: 404,
          text: async () => 'missing',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const copy = Buffer.from(buf);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
        text: async () => '',
      };
    }
    if (method === 'DELETE') {
      blobs.delete(href);
      return { ok: true, status: 204, text: async () => '' };
    }
    return { ok: false, status: 500, text: async () => 'nope' };
  };

  try {
    const client = createS3Client({
      endpoint: 'https://storage.example.test',
      region: 'auto',
      bucket: 'shelterlink-uploads',
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret_test_value_not_real',
      forcePathStyle: true,
    });
    const key = 'documents/1/aabbccddeeff00112233445566778899.pdf';
    await client.put(key, Buffer.from('%PDF-1.4'), 'application/pdf');
    const got = await client.get(key);
    assert.equal(got.toString(), '%PDF-1.4');
    await client.remove(key);
    assert.equal(await client.get(key), null);

    assert.ok(calls.some((c) => c.method === 'PUT' && Boolean(c.headers.Authorization)));
    assert.ok(calls.every((c) => c.headers['x-amz-content-sha256']));
    assert.ok(calls.every((c) => !JSON.stringify(c.headers).includes('secret_test_value_not_real')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('UserDocument.create stores storage_key and not content when object storage is on', async () => {
  const db = require('../config/database');
  const UserDocument = require('../models/UserDocument');
  const previousExecute = db.pool.execute;
  const puts = [];
  let insertParams = null;

  await withEnv(FULL_S3_ENV, async () => {
    const storage = getObjectStorage();
    const originalPut = storage.put;
    const originalRemove = storage.remove;
    storage.put = async (key, buf, mime) => {
      puts.push({ key, mime, len: buf.length });
    };
    storage.remove = async () => {};

    db.pool.execute = async (sql, params) => {
      if (/INSERT INTO user_documents/i.test(sql)) {
        insertParams = params;
        return [{ insertId: 99 }];
      }
      if (/FROM user_documents WHERE id/i.test(sql)) {
        return [[{
          id: 99,
          user_id: 2,
          filename: 'x.pdf',
          original_name: 'ref.pdf',
          mime_type: 'application/pdf',
          size: 4,
          uploaded_at: new Date(),
          expires_at: null,
          label: null,
        }]];
      }
      return [[]];
    };

    try {
      const doc = await UserDocument.create({
        userId: 2,
        content: Buffer.from('%PDF'),
        filename: 'x.pdf',
        originalName: 'ref.pdf',
        mimeType: 'application/pdf',
        size: 4,
      });
      assert.equal(doc.id, 99);
      assert.equal(puts.length, 1);
      assert.match(puts[0].key, /^documents\/2\/[a-f0-9]{32}\.pdf$/);
      assert.equal(insertParams[7], null, 'content column left null');
      assert.equal(insertParams[8], puts[0].key);
      assert.equal(Object.prototype.hasOwnProperty.call(doc, 'storage_key'), false);
    } finally {
      db.pool.execute = previousExecute;
      storage.put = originalPut;
      storage.remove = originalRemove;
    }
  });
});

test('UserDocument.getContent reads from object storage when storage_key is set', async () => {
  const db = require('../config/database');
  const UserDocument = require('../models/UserDocument');
  const previousExecute = db.pool.execute;

  await withEnv(FULL_S3_ENV, async () => {
    const storage = getObjectStorage();
    const originalGet = storage.get;
    storage.get = async (key) => {
      assert.equal(key, 'documents/2/abc.pdf');
      return Buffer.from('%PDF-object');
    };
    db.pool.execute = async () => [[
      {
        content: null,
        storage_key: 'documents/2/abc.pdf',
        mime_type: 'application/pdf',
        original_name: 'ref.pdf',
        filename: 'x.pdf',
      },
    ]];

    try {
      const file = await UserDocument.getContent(9);
      assert.equal(file.buffer.toString(), '%PDF-object');
      assert.equal(file.mimeType, 'application/pdf');
    } finally {
      db.pool.execute = previousExecute;
      storage.get = originalGet;
    }
  });
});

test('Animal.setPhoto uses storage_key when object storage is on', async () => {
  const db = require('../config/database');
  const Animal = require('../models/Animal');
  const previousExecute = db.pool.execute;
  let insertParams = null;

  await withEnv(FULL_S3_ENV, async () => {
    const storage = getObjectStorage();
    const originalPut = storage.put;
    storage.put = async () => {};

    db.pool.execute = async (sql, params) => {
      if (/SELECT\s+storage_key/i.test(sql)) return [[]];
      if (/INSERT INTO animal_photos/i.test(sql)) {
        insertParams = params;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    };

    try {
      await Animal.setPhoto(3, { content: Buffer.from('jpegbytes'), mimeType: 'image/png' });
      assert.equal(insertParams[1], null, 'content null when using object storage');
      assert.equal(insertParams[2], 'image/png');
      assert.match(insertParams[3], /^animal-photos\/3\/[a-f0-9]{32}\.png$/);
    } finally {
      db.pool.execute = previousExecute;
      storage.put = originalPut;
    }
  });
});

test('migration 045 and docs exist; no AWS SDK dependency', () => {
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'database/045_object_storage_keys.pg.sql')));
  assert.ok(fs.existsSync(path.join(root, 'docs/OBJECT-STORAGE.md')));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal(deps['@aws-sdk/client-s3'], undefined);
  assert.equal(deps['aws-sdk'], undefined);
  assert.ok(REQUIRED_ENV.includes('OBJECT_STORAGE_BUCKET'));
});
