'use strict';

/**
 * Per-shelter brand colour and logo (SL-LATER-10).
 * Colour uses shelters.primary_colour (036). Logo uses shelters.logo /
 * logo_mime, optionally logo_storage_key (049) via object storage.
 *
 * shelters UPDATE is revoked from shelterlink_tenant, so writes run under
 * runWithoutShelter and always name the bound shelter id.
 */

const { pool } = require('../config/database');
const {
  currentShelterId,
  runWithoutShelter,
} = require('../utils/shelterContext');
const { sniffImage, canonicalMime } = require('../utils/fileSignature');
const {
  getObjectStorage,
  buildObjectKey,
} = require('../utils/objectStorage');
const {
  evaluateBrandColour,
  tokensForStoredColour,
} = require('../utils/colourContrast');

const LOGO_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_LOGO_BYTES = 512 * 1024;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireShelterId() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Shelter context is missing');
  return id;
}

function publicBrand(row) {
  if (!row || !row.name) return null;
  const primaryColour = row.primary_colour || null;
  const tokens = tokensForStoredColour(primaryColour);
  return {
    name: row.name,
    slug: row.slug || null,
    hasLogo: Boolean(row.has_logo),
    primaryColour: tokens ? primaryColour : null,
    colourTokens: tokens,
  };
}

async function readRow(shelterId) {
  const [rows] = await pool.execute(
    `SELECT name, slug, primary_colour, logo_mime, logo_storage_key,
            ( (logo IS NOT NULL AND octet_length(logo) > 0)
              OR (logo_storage_key IS NOT NULL AND length(logo_storage_key) > 0)
            ) AS has_logo
       FROM shelters
      WHERE id = ?`,
    [shelterId]
  );
  return rows[0] || null;
}

async function getPublicBrand() {
  const id = requireShelterId();
  return publicBrand(await readRow(id));
}

async function getSettings() {
  const id = requireShelterId();
  const row = await readRow(id);
  if (!row) throw fail(404, 'Shelter not found');
  const brand = publicBrand(row);
  return {
    name: brand.name,
    slug: brand.slug,
    hasLogo: brand.hasLogo,
    primary_colour: brand.primaryColour,
    colourTokens: brand.colourTokens,
    default_colour: '#0f766e',
  };
}

async function setPrimaryColour(rawColour) {
  const id = requireShelterId();
  const cleared = rawColour == null || rawColour === '';
  const evaluated = evaluateBrandColour(cleared ? null : rawColour);
  if (!evaluated.ok) throw fail(400, evaluated.error);

  await runWithoutShelter(() => pool.execute(
    `UPDATE shelters SET primary_colour = ? WHERE id = ?`,
    [evaluated.hex, id]
  ));

  return getSettings();
}

async function readLogoBytes() {
  const id = requireShelterId();
  const [rows] = await pool.execute(
    'SELECT logo, logo_mime, logo_storage_key FROM shelters WHERE id = ?',
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const mime = String(row.logo_mime || '').toLowerCase();
  if (!LOGO_TYPES.has(mime)) return null;

  if (row.logo_storage_key) {
    const buffer = await getObjectStorage().get(row.logo_storage_key);
    if (!buffer || !buffer.length) return null;
    return { buffer, mime };
  }
  if (!row.logo) return null;
  const buffer = Buffer.isBuffer(row.logo) ? row.logo : Buffer.from(row.logo);
  if (!buffer.length) return null;
  return { buffer, mime };
}

async function setLogo({ content, mimeType }) {
  const id = requireShelterId();
  if (!Buffer.isBuffer(content) || !content.length) {
    throw fail(400, 'Logo is required');
  }
  if (content.length > MAX_LOGO_BYTES) {
    throw fail(400, 'Logo must be a PNG or JPEG under 512KB');
  }
  const detected = sniffImage(content);
  if (!detected || detected !== canonicalMime(mimeType) || !LOGO_TYPES.has(detected)) {
    throw fail(400, 'Logo must be a PNG or JPEG under 512KB');
  }

  const [existingRows] = await pool.execute(
    'SELECT logo_storage_key FROM shelters WHERE id = ?',
    [id]
  );
  if (!existingRows.length) throw fail(404, 'Shelter not found');
  const previousKey = existingRows[0].logo_storage_key || null;

  const storage = getObjectStorage();
  let storageKey = null;
  let dbContent = content;

  if (storage.isConfigured()) {
    const ext = detected === 'image/png' ? '.png' : '.jpg';
    storageKey = buildObjectKey('shelter-logos', id, ext);
    await storage.put(storageKey, content, detected);
    dbContent = null;
  }

  try {
    await runWithoutShelter(() => pool.execute(
      `UPDATE shelters
          SET logo = ?, logo_mime = ?, logo_storage_key = ?
        WHERE id = ?`,
      [dbContent, detected, storageKey, id]
    ));
  } catch (error) {
    if (storageKey) {
      try {
        await storage.remove(storageKey);
      } catch (_) {
        /* best-effort cleanup */
      }
    }
    throw error;
  }

  if (previousKey && previousKey !== storageKey) {
    try {
      await storage.remove(previousKey);
    } catch (error) {
      console.error('[ShelterBrand] previous logo object delete failed:', error.message);
    }
  }

  return getSettings();
}

module.exports = {
  LOGO_TYPES,
  MAX_LOGO_BYTES,
  getPublicBrand,
  getSettings,
  setPrimaryColour,
  readLogoBytes,
  setLogo,
  publicBrand,
};
