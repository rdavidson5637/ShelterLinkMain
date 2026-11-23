'use strict';

/**
 * Minimal S3-compatible client (PutObject / GetObject / DeleteObject).
 * Uses Node's built-in crypto + fetch — no AWS SDK, no paid dependency.
 * Works with Cloudflare R2, MinIO, Supabase Storage S3, and AWS S3.
 */

const crypto = require('crypto');
const { URL } = require('url');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function amzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz: iso, short: iso.slice(0, 8) };
}

function encodeKey(key) {
  return String(key)
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function signingKey(secret, shortDate, region, service) {
  const kDate = hmac(`AWS4${secret}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function buildCanonicalRequest({ method, canonicalUri, canonicalQuery, headers, signedHeaders, payloadHash }) {
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  return [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
}

function authorize({
  method,
  url,
  headers,
  payload,
  accessKeyId,
  secretAccessKey,
  region,
  service = 's3',
}) {
  const { amz, short } = amzDate();
  const payloadHash = sha256Hex(payload || Buffer.alloc(0));
  const host = url.host;
  const signedHeadersList = ['host', 'x-amz-content-sha256', 'x-amz-date'];
  if (headers['content-type']) signedHeadersList.push('content-type');
  signedHeadersList.sort();

  const headerMap = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
  };
  if (headers['content-type']) {
    headerMap['content-type'] = headers['content-type'];
  }

  const canonicalRequest = buildCanonicalRequest({
    method,
    canonicalUri: url.pathname,
    canonicalQuery: '',
    headers: headerMap,
    signedHeaders: signedHeadersList,
    payloadHash,
  });

  const credentialScope = `${short}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', signingKey(secretAccessKey, short, region, service))
    .update(stringToSign)
    .digest('hex');

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList.join(';')}, Signature=${signature}`,
    amzDate: amz,
    payloadHash,
  };
}

function createS3Client(config) {
  const {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle = true,
  } = config;

  const base = new URL(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);

  function objectUrl(key) {
    const encoded = encodeKey(key);
    if (forcePathStyle) {
      return new URL(`${base.origin}${base.pathname.replace(/\/$/, '')}/${bucket}/${encoded}`);
    }
    const host = `${bucket}.${base.host}`;
    return new URL(`${base.protocol}//${host}${base.pathname.replace(/\/$/, '')}/${encoded}`);
  }

  async function request(method, key, { body, contentType } = {}) {
    const url = objectUrl(key);
    const headers = {};
    if (contentType) headers['content-type'] = contentType;
    const payload = body ? Buffer.from(body) : Buffer.alloc(0);
    const auth = authorize({
      method,
      url,
      headers,
      payload,
      accessKeyId,
      secretAccessKey,
      region,
    });
    const res = await fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: auth.authorization,
        'x-amz-date': auth.amzDate,
        'x-amz-content-sha256': auth.payloadHash,
      },
      body: method === 'GET' || method === 'DELETE' ? undefined : payload,
    });
    return res;
  }

  return {
    name: 's3',
    async put(key, buffer, contentType) {
      const res = await request('PUT', key, { body: buffer, contentType });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`Object storage put failed (${res.status})`);
        err.status = res.status;
        err.detail = text.slice(0, 200);
        throw err;
      }
    },
    async get(key) {
      const res = await request('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`Object storage get failed (${res.status})`);
        err.status = res.status;
        err.detail = text.slice(0, 200);
        throw err;
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    },
    async remove(key) {
      const res = await request('DELETE', key);
      if (res.status === 404) return;
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => '');
        const err = new Error(`Object storage delete failed (${res.status})`);
        err.status = res.status;
        err.detail = text.slice(0, 200);
        throw err;
      }
    },
  };
}

module.exports = {
  createS3Client,
  encodeKey,
  authorize,
  sha256Hex,
};
