'use strict';

const TrainingModule = require('../models/TrainingModule');
const Qualification = require('../models/Qualification');
const { isAdminUser } = require('../middleware/auth');

function ensureAdmin(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isAdminUser(req)) {
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

function parsePassMark(value, fallback = 80) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.floor(n);
}

function parseActive(value, fallback = true) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return Boolean(value);
}

async function listModules(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const isAdmin = isAdminUser(req);
    const modules = await TrainingModule.findAll({ activeOnly: !isAdmin });
    return res.status(200).json(modules);
  } catch (error) {
    console.error('[Training] listModules error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getModule(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const isAdmin = isAdminUser(req);
    const module = await TrainingModule.findById(req.params.id, {
      includeInactive: isAdmin,
    });
    if (!module) {
      return res.status(404).json({ error: 'Training module not found' });
    }

    const questions = await TrainingModule.findQuestions(module.id, {
      includeAnswer: isAdmin,
    });

    let my_attempts = [];
    if (!isAdmin || req.query.include_attempts === '1') {
      my_attempts = await TrainingModule.findAttemptsForUser(
        req.session.userId,
        module.id
      );
    }

    return res.status(200).json({
      ...module,
      questions,
      my_attempts,
      has_passed: my_attempts.some((a) => a.passed),
    });
  } catch (error) {
    console.error('[Training] getModule error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createModule(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const pass_mark_percent = parsePassMark(req.body?.pass_mark_percent, 80);
    if (pass_mark_percent == null) {
      return res.status(400).json({ error: 'pass_mark_percent must be between 1 and 100' });
    }

    let awards_qualification_id =
      req.body?.awards_qualification_id ?? req.body?.awardsQualificationId ?? null;
    if (awards_qualification_id === '' || awards_qualification_id === undefined) {
      awards_qualification_id = null;
    } else if (awards_qualification_id !== null) {
      awards_qualification_id = Number(awards_qualification_id);
      if (!Number.isFinite(awards_qualification_id) || awards_qualification_id <= 0) {
        return res.status(400).json({ error: 'awards_qualification_id is invalid' });
      }
      const qual = await Qualification.findById(awards_qualification_id);
      if (!qual) {
        return res.status(400).json({ error: 'awards_qualification_id not found' });
      }
    }

    const created = await TrainingModule.create({
      name,
      description:
        req.body?.description == null ? null : String(req.body.description).trim(),
      content: req.body?.content == null ? '' : String(req.body.content),
      pass_mark_percent,
      awards_qualification_id,
      active: parseActive(req.body?.active, true),
    });

    if (Array.isArray(req.body?.questions) && req.body.questions.length) {
      await TrainingModule.replaceQuestions(created.id, req.body.questions);
      const withQuestions = await TrainingModule.findById(created.id, {
        includeInactive: true,
      });
      const questions = await TrainingModule.findQuestions(created.id, {
        includeAnswer: true,
      });
      return res.status(201).json({ ...withQuestions, questions });
    }

    return res.status(201).json({ ...created, questions: [] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ error: 'A training module with that name already exists' });
    }
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[Training] createModule error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateModule(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const data = {};
    if (typeof req.body?.name !== 'undefined') {
      data.name = String(req.body.name).trim();
      if (!data.name) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
    }
    if (typeof req.body?.description !== 'undefined') {
      data.description =
        req.body.description == null ? null : String(req.body.description).trim();
    }
    if (typeof req.body?.content !== 'undefined') {
      data.content = req.body.content == null ? '' : String(req.body.content);
    }
    if (typeof req.body?.pass_mark_percent !== 'undefined') {
      const mark = parsePassMark(req.body.pass_mark_percent, null);
      if (mark == null) {
        return res.status(400).json({ error: 'pass_mark_percent must be between 1 and 100' });
      }
      data.pass_mark_percent = mark;
    }
    if (
      typeof req.body?.awards_qualification_id !== 'undefined' ||
      typeof req.body?.awardsQualificationId !== 'undefined'
    ) {
      let qid = req.body.awards_qualification_id ?? req.body.awardsQualificationId;
      if (qid === '' || qid === null) {
        data.awards_qualification_id = null;
      } else {
        qid = Number(qid);
        if (!Number.isFinite(qid) || qid <= 0) {
          return res.status(400).json({ error: 'awards_qualification_id is invalid' });
        }
        const qual = await Qualification.findById(qid);
        if (!qual) {
          return res.status(400).json({ error: 'awards_qualification_id not found' });
        }
        data.awards_qualification_id = qid;
      }
    }
    if (typeof req.body?.active !== 'undefined') {
      data.active = parseActive(req.body.active);
    }

    if (!Object.keys(data).length && !Array.isArray(req.body?.questions)) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    let updated = null;
    if (Object.keys(data).length) {
      updated = await TrainingModule.update(req.params.id, data);
      if (!updated) {
        return res.status(404).json({ error: 'Training module not found' });
      }
    } else {
      updated = await TrainingModule.findById(req.params.id, { includeInactive: true });
      if (!updated) {
        return res.status(404).json({ error: 'Training module not found' });
      }
    }

    let questions;
    if (Array.isArray(req.body?.questions)) {
      questions = await TrainingModule.replaceQuestions(updated.id, req.body.questions);
      updated = await TrainingModule.findById(updated.id, { includeInactive: true });
    } else {
      questions = await TrainingModule.findQuestions(updated.id, { includeAnswer: true });
    }

    return res.status(200).json({ ...updated, questions });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ error: 'A training module with that name already exists' });
    }
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[Training] updateModule error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteModule(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const deleted = await TrainingModule.remove(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Training module not found' });
    }
    return res.status(200).json({ message: 'Training module deleted' });
  } catch (error) {
    console.error('[Training] deleteModule error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function submitAttempt(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const moduleId = Number(req.params.id);
    const answers = req.body?.answers;
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: 'answers must be a non-empty array' });
    }

    const result = await TrainingModule.recordAttempt({
      userId: req.session.userId,
      moduleId,
      answers,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[Training] submitAttempt error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function myAttempts(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const rows = await TrainingModule.findAttemptsForUser(req.session.userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Training] myAttempts error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listModules,
  getModule,
  createModule,
  updateModule,
  deleteModule,
  submitAttempt,
  myAttempts,
};
