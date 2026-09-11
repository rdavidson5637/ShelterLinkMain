'use strict';

const crypto = require('crypto');
const multer = require('multer');
const Animal = require('../models/Animal');
const UserDocument = require('../models/UserDocument');
const Application = require('../models/Application');
const { isStaffOrAdmin } = require('../middleware/auth');

const IMAGE_MIME = new Set(['image/jpeg', 'image/png']);

function ensureStaff(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function ensureAuth(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Held in memory then written to Postgres (animal_photos) — an ephemeral host
// filesystem would lose disk-written photos on every redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UserDocument.MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (!IMAGE_MIME.has(String(file.mimetype || '').toLowerCase())) {
      const err = new Error('Only JPG and PNG photos are allowed');
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
  if (err.code === 'INVALID_MIME' || /Only JPG/i.test(err.message || '')) {
    res.status(400).json({ error: 'Only JPG and PNG photos are allowed' });
    return true;
  }
  res.status(400).json({ error: err.message || 'Upload failed' });
  return true;
}

function toPublicAnimal(animal, { includeHandling = false } = {}) {
  if (!animal) return null;
  const out = {
    id: animal.id,
    name: animal.name,
    species: animal.species,
    breed: animal.breed,
    sex: animal.sex,
    status: animal.status,
    kennel_ref: animal.kennel_ref,
    photo_filename: animal.photo_filename,
    requires_qualification_id: animal.requires_qualification_id,
    requires_qualification_name: animal.requires_qualification_name,
  };
  if (includeHandling) {
    out.handling_notes = animal.handling_notes;
  }
  return out;
}

async function listAnimals(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const animals = await Animal.findAll({
      species: req.query.species || null,
      status: req.query.status || null,
    });
    return res.status(200).json(animals);
  } catch (error) {
    console.error('[Animal] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAnimal(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const animal = await Animal.findById(req.params.id);
    if (!animal) return res.status(404).json({ error: 'Animal not found' });

    const staff = isStaffOrAdmin(req);
    if (staff) {
      const Incident = require('../models/Incident');
      const activity = await Animal.findActivityForAnimal(animal.id);
      const incidents = await Incident.list({ animalId: animal.id });
      return res.status(200).json({ ...animal, activity, incidents });
    }

    // Volunteers see public fields + handling notes only when they have an
    // accepted shift that includes this animal.
    const apps = await Application.findByUserId(req.session.userId);
    const acceptedOppIds = (apps || [])
      .filter((a) => ['accepted', 'approved'].includes(a.status))
      .map((a) => Number(a.opportunity_id));
    let includeHandling = false;
    for (const oppId of acceptedOppIds) {
      const animals = await Animal.findForOpportunity(oppId);
      if (animals.some((a) => Number(a.id) === Number(animal.id))) {
        includeHandling = true;
        break;
      }
    }

    return res.status(200).json(toPublicAnimal(animal, { includeHandling }));
  } catch (error) {
    console.error('[Animal] get error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createAnimal(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const animal = await Animal.create(req.body || {});
    return res.status(201).json(animal);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Animal] create error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAnimal(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const animal = await Animal.update(req.params.id, req.body || {});
    if (!animal) return res.status(404).json({ error: 'Animal not found' });
    return res.status(200).json(animal);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Animal] update error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function uploadPhoto(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    const existing = await Animal.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Animal not found' });
    }

    await Animal.setPhoto(req.params.id, {
      content: req.file.buffer,
      mimeType: String(req.file.mimetype || 'image/jpeg').toLowerCase(),
    });

    // photo_filename is now just a "has photo" marker and cache-buster for the
    // <img> URL; the bytes live in animal_photos.
    const animal = await Animal.update(req.params.id, {
      photo_filename: `animal-${crypto.randomBytes(16).toString('hex')}`,
    });
    return res.status(200).json(animal);
  } catch (error) {
    console.error('[Animal] uploadPhoto error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPhoto(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const photo = await Animal.getPhoto(req.params.id);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    res.setHeader('Content-Type', photo.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(photo.buffer);
  } catch (error) {
    console.error('[Animal] getPhoto error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function logActivity(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const userId = req.session.userId;
    const animalId = Number(req.params.id);
    const { application_id, activity_type, notes } = req.body || {};

    if (!application_id) {
      return res.status(400).json({ error: 'application_id is required' });
    }
    if (!Animal.ACTIVITY_TYPES.has(activity_type)) {
      return res.status(400).json({ error: 'Invalid activity_type' });
    }

    const eligible = await Animal.assertCanLogActivity(
      userId,
      animalId,
      Number(application_id)
    );
    if (!eligible) {
      return res.status(403).json({
        error:
          'You can only log activity for animals on a shift you are accepted for.',
      });
    }

    const row = await Animal.logActivity({
      animalId,
      userId,
      applicationId: Number(application_id),
      activityType: activity_type,
      notes: notes || null,
    });
    return res.status(201).json(row);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Animal] logActivity error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function myHelpedAnimals(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const rows = await Animal.findHelpedByUser(req.session.userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Animal] myHelpedAnimals error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  upload,
  handleMulterError,
  listAnimals,
  getAnimal,
  createAnimal,
  updateAnimal,
  uploadPhoto,
  getPhoto,
  logActivity,
  myHelpedAnimals,
  toPublicAnimal,
};
