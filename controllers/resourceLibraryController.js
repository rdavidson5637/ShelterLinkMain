'use strict';

/**
 * Shelter resource library endpoints (SL-DAY-04).
 *   GET/DELETE     /api/resources/:id
 *   GET            /api/resources
 *   POST           /api/resources/links
 *   POST           /api/resources/files
 *   PUT            /api/resources/:id
 *   GET            /api/resources/:id/download
 *
 * Auth required for every route. Staff manage the library; volunteers
 * see active items only. Nothing is exposed on /api/public.
 */

const multer = require('multer');
const ShelterResource = require('../models/ShelterResource');
const { isAdminUser } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ShelterResource.MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (!ShelterResource.isAllowedMime(file.mimetype)) {
      const err = new Error('Only PDF, JPG, and PNG files are allowed');
      err.code = 'INVALID_MIME';
      return cb(err);
    }
    return cb(null, true);
  },
});

function handleMulterError(err, res) {
  if (!err) return false;
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    return true;
  }
  if (err.code === 'INVALID_MIME' || err.message?.includes('Only PDF')) {
    res.status(400).json({ error: 'Only PDF, JPG, and PNG files are allowed' });
    return true;
  }
  console.error('[Resources] multer error:', err.message);
  res.status(400).json({ error: err.message || 'Upload failed' });
  return true;
}

function isStaffOrAdmin(req) {
  const role = req.session?.role;
  return role === 'staff' || role === 'admin' || isAdminUser(req);
}

async function listResources(req, res) {
  try {
    const staff = isStaffOrAdmin(req);
    const wantAll =
      staff &&
      (req.query?.active === '0' ||
        req.query?.active === 'false' ||
        req.query?.all === '1' ||
        req.query?.all === 'true');
    const activeOnly = !wantAll;
    const items = await ShelterResource.listResources({ activeOnly });
    return res.status(200).json({ items, total: items.length });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Resources] listResources error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createLink(req, res) {
  try {
    const item = await ShelterResource.createLink({
      title: req.body?.title,
      url: req.body?.url,
      sort_order: req.body?.sort_order,
      createdBy: req.session?.userId || null,
    });
    return res.status(201).json({ message: 'Link added', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Resources] createLink error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    const item = await ShelterResource.createFile({
      title: req.body?.title,
      content: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      sort_order: req.body?.sort_order,
      createdBy: req.session?.userId || null,
    });
    return res.status(201).json({ message: 'File added', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Resources] createFile error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateResource(req, res) {
  try {
    const item = await ShelterResource.updateResource(Number(req.params.id), {
      title: req.body?.title,
      url: req.body?.url,
      sort_order: req.body?.sort_order,
      active: req.body?.active,
    });
    return res.status(200).json({ message: 'Resource updated', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Resources] updateResource error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteResource(req, res) {
  try {
    const result = await ShelterResource.remove(Number(req.params.id));
    return res.status(200).json({ message: 'Resource deleted', ...result });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Resources] deleteResource error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function downloadResource(req, res) {
  try {
    const id = Number(req.params.id);
    const meta = await ShelterResource.findById(id);
    if (!meta || meta.kind !== 'file') {
      return res.status(404).json({ error: 'Resource not found' });
    }
    if (!meta.active && !isStaffOrAdmin(req)) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const file = await ShelterResource.getContent(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const downloadName = ShelterResource.safeDownloadName(file.originalName);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName}"`
    );
    return res.send(file.buffer);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Resources] downloadResource error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  upload,
  handleMulterError,
  listResources,
  createLink,
  createFile,
  updateResource,
  deleteResource,
  downloadResource,
};
