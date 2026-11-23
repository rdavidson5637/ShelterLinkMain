'use strict';

/**
 * Admin branding settings (SL-LATER-10).
 *   GET  /api/admin/settings/brand       staff or admin
 *   PUT  /api/admin/settings/brand       admin only (accent / primary colour)
 *   POST /api/admin/settings/brand/logo  admin only (multipart logo)
 */

const multer = require('multer');
const ShelterBrand = require('../models/ShelterBrand');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ShelterBrand.MAX_LOGO_BYTES },
  fileFilter(_req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!ShelterBrand.LOGO_TYPES.has(mime)) {
      const err = new Error('Logo must be a PNG or JPEG under 512KB');
      err.code = 'INVALID_MIME';
      return cb(err);
    }
    return cb(null, true);
  },
});

function handleMulterError(err, res) {
  if (!err) return false;
  if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'INVALID_MIME') {
    res.status(400).json({ error: 'Logo must be a PNG or JPEG under 512KB' });
    return true;
  }
  res.status(400).json({ error: err.message || 'Upload failed' });
  return true;
}

async function getBrandSettings(req, res) {
  try {
    const settings = await ShelterBrand.getSettings();
    return res.status(200).json(settings);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[ShelterBrand] getBrandSettings error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateBrandSettings(req, res) {
  try {
    const raw = req.body && Object.prototype.hasOwnProperty.call(req.body, 'primary_colour')
      ? req.body.primary_colour
      : undefined;
    if (raw === undefined) {
      return res.status(400).json({ error: 'primary_colour is required (hex colour or null to clear)' });
    }
    const settings = await ShelterBrand.setPrimaryColour(raw);
    return res.status(200).json({
      message: settings.primary_colour
        ? 'Accent colour saved'
        : 'Accent colour cleared; pages use the default teal',
      ...settings,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[ShelterBrand] updateBrandSettings error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function uploadBrandLogo(req, res) {
  try {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: 'Logo is required' });
    }
    const settings = await ShelterBrand.setLogo({
      content: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    return res.status(200).json({
      message: 'Logo uploaded',
      ...settings,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[ShelterBrand] uploadBrandLogo error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  upload,
  handleMulterError,
  getBrandSettings,
  updateBrandSettings,
  uploadBrandLogo,
};
