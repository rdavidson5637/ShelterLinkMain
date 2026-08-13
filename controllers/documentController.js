'use strict';

const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const UserDocument = require('../models/UserDocument');

const { isStaffOrAdmin } = require('../middleware/auth');

function ensureAdmin(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      cb(null, UserDocument.getUploadDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.pdf', '.jpg', '.jpeg', '.png'].includes(ext) ? ext : '';
    const name = `${crypto.randomBytes(16).toString('hex')}${safeExt}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: UserDocument.MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (!UserDocument.isAllowedMime(file.mimetype)) {
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
  console.error('[Document] multer error:', err.message);
  res.status(400).json({ error: err.message || 'Upload failed' });
  return true;
}

async function uploadDocument(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    if (!UserDocument.isAllowedMime(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, JPG, and PNG files are allowed' });
    }

    const label = req.body?.label != null ? String(req.body.label).trim() : null;
    const doc = await UserDocument.create({
      userId: req.session.userId,
      filename: req.file.filename,
      originalName: req.file.originalname || req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      label: label || null,
    });

    return res.status(201).json(doc);
  } catch (error) {
    console.error('[Document] uploadDocument error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMyDocuments(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const docs = await UserDocument.findByUserId(req.session.userId);
    return res.status(200).json(docs);
  } catch (error) {
    console.error('[Document] listMyDocuments error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listVolunteerDocuments(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const docs = await UserDocument.findByUserId(req.params.userId);
    return res.status(200).json(docs);
  } catch (error) {
    console.error('[Document] listVolunteerDocuments error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateDocument(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const doc = await UserDocument.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const data = {};
    if (typeof req.body?.label !== 'undefined') {
      data.label = req.body.label;
    }
    if (typeof req.body?.expires_at !== 'undefined') {
      data.expires_at = req.body.expires_at;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    const updated = await UserDocument.updateMeta(req.params.id, data);
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[Document] updateDocument error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function downloadDocument(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const doc = await UserDocument.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const isOwner = Number(doc.user_id) === Number(req.session.userId);
    const isAdmin = isStaffOrAdmin(req);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const filePath = UserDocument.absolutePathFor(doc);
    if (!filePath) {
      return res.status(404).json({ error: 'File not found' });
    }

    return res.download(filePath, doc.original_name || doc.filename);
  } catch (error) {
    console.error('[Document] downloadDocument error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteDocument(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const doc = await UserDocument.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const isOwner = Number(doc.user_id) === Number(req.session.userId);
    const isAdmin = isStaffOrAdmin(req);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await UserDocument.remove(req.params.id);
    return res.status(200).json({ message: 'Document deleted' });
  } catch (error) {
    console.error('[Document] deleteDocument error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  upload,
  handleMulterError,
  uploadDocument,
  listMyDocuments,
  listVolunteerDocuments,
  updateDocument,
  downloadDocument,
  deleteDocument,
};
