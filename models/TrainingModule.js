'use strict';

const { pool } = require('../config/database');
const Qualification = require('./Qualification');

/**
 * Score a quiz attempt.
 * questions: [{ id, correct_index }]
 * answers: [{ question_id, selected_index }]
 * Returns { score_percent, passed, correct, total } or throws on bad shape.
 */
function scoreAttempt(questions = [], answers = [], passMarkPercent = 80) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) {
    const err = new Error('This module has no questions yet');
    err.status = 400;
    throw err;
  }

  const byId = new Map();
  for (const row of Array.isArray(answers) ? answers : []) {
    const qid = Number(row.question_id ?? row.questionId);
    const selected = Number(row.selected_index ?? row.selectedIndex);
    if (!Number.isFinite(qid) || !Number.isFinite(selected)) continue;
    byId.set(qid, selected);
  }

  let correct = 0;
  for (const q of list) {
    const id = Number(q.id);
    const expected = Number(q.correct_index);
    const selected = byId.get(id);
    if (selected === expected) correct += 1;
  }

  const total = list.length;
  const score_percent = Math.floor((correct / total) * 100);
  const mark = Number(passMarkPercent);
  const passed = Number.isFinite(mark) && score_percent >= mark;
  return { score_percent, passed, correct, total };
}

function parseChoices(raw) {
  if (Array.isArray(raw)) return raw.map((c) => String(c));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((c) => String(c));
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeValidityMonths(value) {
  if (value === null || value === undefined || value === '') return null;
  const months = Number(value);
  if (!Number.isFinite(months) || months <= 0) return null;
  return Math.floor(months);
}

function mapModule(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    pass_mark_percent: Number(row.pass_mark_percent),
    awards_qualification_id:
      row.awards_qualification_id == null ? null : Number(row.awards_qualification_id),
    awards_qualification_name: row.awards_qualification_name || null,
    validity_months: normalizeValidityMonths(row.validity_months),
    active: Number(row.active) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    question_count:
      row.question_count == null ? undefined : Number(row.question_count),
  };
}

function mapQuestion(row, { includeAnswer = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    module_id: row.module_id,
    prompt: row.prompt,
    choices: parseChoices(row.choices),
    sort_order: Number(row.sort_order) || 0,
  };
  if (includeAnswer) {
    out.correct_index = Number(row.correct_index);
  }
  return out;
}

async function create({
  name,
  description = null,
  content = '',
  pass_mark_percent = 80,
  awards_qualification_id = null,
  validity_months = null,
  active = true,
}) {
  const sql = `
    INSERT INTO training_modules
      (name, description, content, pass_mark_percent, awards_qualification_id, validity_months, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    name,
    description || null,
    content == null ? '' : String(content),
    Number(pass_mark_percent),
    awards_qualification_id == null || awards_qualification_id === ''
      ? null
      : Number(awards_qualification_id),
    normalizeValidityMonths(validity_months),
    active ? 1 : 0,
  ]);
  return findById(result.insertId, { includeInactive: true });
}

async function findById(id, { includeInactive = false } = {}) {
  const sql = `
    SELECT
      m.id, m.name, m.description, m.content, m.pass_mark_percent,
      m.awards_qualification_id, m.validity_months, m.active, m.created_at, m.updated_at,
      q.name AS awards_qualification_name,
      (SELECT COUNT(*)::int FROM training_questions tq WHERE tq.module_id = m.id) AS question_count
    FROM training_modules m
    LEFT JOIN qualifications q ON q.id = m.awards_qualification_id
    WHERE m.id = ?
      ${includeInactive ? '' : 'AND m.active = 1'}
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [id]);
  return mapModule(rows[0] || null);
}

async function findAll({ activeOnly = false } = {}) {
  const sql = `
    SELECT
      m.id, m.name, m.description, m.content, m.pass_mark_percent,
      m.awards_qualification_id, m.validity_months, m.active, m.created_at, m.updated_at,
      q.name AS awards_qualification_name,
      (SELECT COUNT(*)::int FROM training_questions tq WHERE tq.module_id = m.id) AS question_count
    FROM training_modules m
    LEFT JOIN qualifications q ON q.id = m.awards_qualification_id
    ${activeOnly ? 'WHERE m.active = 1' : ''}
    ORDER BY m.name ASC
  `;
  const [rows] = await pool.execute(sql);
  return rows.map(mapModule);
}

async function update(id, data = {}) {
  const fields = [];
  const params = [];

  if (typeof data.name !== 'undefined') {
    fields.push('name = ?');
    params.push(String(data.name).trim());
  }
  if (typeof data.description !== 'undefined') {
    fields.push('description = ?');
    params.push(data.description == null ? null : String(data.description));
  }
  if (typeof data.content !== 'undefined') {
    fields.push('content = ?');
    params.push(data.content == null ? '' : String(data.content));
  }
  if (typeof data.pass_mark_percent !== 'undefined') {
    fields.push('pass_mark_percent = ?');
    params.push(Number(data.pass_mark_percent));
  }
  if (typeof data.awards_qualification_id !== 'undefined') {
    fields.push('awards_qualification_id = ?');
    params.push(
      data.awards_qualification_id == null || data.awards_qualification_id === ''
        ? null
        : Number(data.awards_qualification_id)
    );
  }
  if (typeof data.validity_months !== 'undefined') {
    fields.push('validity_months = ?');
    params.push(normalizeValidityMonths(data.validity_months));
  }
  if (typeof data.active !== 'undefined') {
    fields.push('active = ?');
    params.push(data.active ? 1 : 0);
  }

  if (!fields.length) {
    throw new Error('No training module fields provided for update');
  }

  params.push(id);
  const [result] = await pool.execute(
    `UPDATE training_modules SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  if (!result.affectedRows) return null;
  return findById(id, { includeInactive: true });
}

async function remove(id) {
  const [result] = await pool.execute(`DELETE FROM training_modules WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

async function findQuestions(moduleId, { includeAnswer = false } = {}) {
  const [rows] = await pool.execute(
    `SELECT id, module_id, prompt, choices, correct_index, sort_order
     FROM training_questions
     WHERE module_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [moduleId]
  );
  return rows.map((row) => mapQuestion(row, { includeAnswer }));
}

async function findQuestionsRaw(moduleId) {
  const [rows] = await pool.execute(
    `SELECT id, module_id, prompt, choices, correct_index, sort_order
     FROM training_questions
     WHERE module_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [moduleId]
  );
  return rows;
}

async function replaceQuestions(moduleId, questions = []) {
  await pool.execute(`DELETE FROM training_questions WHERE module_id = ?`, [moduleId]);

  const list = Array.isArray(questions) ? questions : [];
  let order = 0;
  for (const q of list) {
    const prompt = String(q.prompt || '').trim();
    const choices = Array.isArray(q.choices)
      ? q.choices.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const correct_index = Number(q.correct_index ?? q.correctIndex);
    if (!prompt || choices.length < 2) {
      const err = new Error('Each question needs a prompt and at least two choices');
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(correct_index) || correct_index < 0 || correct_index >= choices.length) {
      const err = new Error('correct_index must point at one of the choices');
      err.status = 400;
      throw err;
    }
    const sort_order =
      q.sort_order == null || q.sort_order === '' ? order : Number(q.sort_order);
    await pool.execute(
      `INSERT INTO training_questions
         (module_id, prompt, choices, correct_index, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [moduleId, prompt, JSON.stringify(choices), correct_index, sort_order]
    );
    order += 1;
  }

  return findQuestions(moduleId, { includeAnswer: true });
}

async function findAttemptsForUser(userId, moduleId = null) {
  const params = [userId];
  let sql = `
    SELECT
      a.id, a.module_id, a.user_id, a.score_percent, a.passed, a.answers, a.attempted_at,
      m.name AS module_name, m.pass_mark_percent
    FROM training_attempts a
    INNER JOIN training_modules m ON m.id = a.module_id
    WHERE a.user_id = ?
  `;
  if (moduleId != null) {
    sql += ' AND a.module_id = ?';
    params.push(moduleId);
  }
  sql += ' ORDER BY a.attempted_at DESC, a.id DESC';
  const [rows] = await pool.execute(sql, params);
  return rows.map((row) => ({
    id: row.id,
    module_id: row.module_id,
    module_name: row.module_name,
    user_id: row.user_id,
    score_percent: Number(row.score_percent),
    passed: Number(row.passed) === 1,
    pass_mark_percent: Number(row.pass_mark_percent),
    answers: typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers,
    attempted_at: row.attempted_at,
  }));
}

async function recordAttempt({
  userId,
  moduleId,
  answers,
  asOf = new Date(),
}) {
  const module = await findById(moduleId, { includeInactive: true });
  if (!module) {
    const err = new Error('Training module not found');
    err.status = 404;
    throw err;
  }
  if (!module.active) {
    const err = new Error('This training module is not available');
    err.status = 400;
    throw err;
  }

  const rawQuestions = await findQuestionsRaw(moduleId);
  const scored = scoreAttempt(rawQuestions, answers, module.pass_mark_percent);

  const answerPayload = (Array.isArray(answers) ? answers : []).map((a) => ({
    question_id: Number(a.question_id ?? a.questionId),
    selected_index: Number(a.selected_index ?? a.selectedIndex),
  }));

  const [result] = await pool.execute(
    `INSERT INTO training_attempts
       (module_id, user_id, score_percent, passed, answers)
     VALUES (?, ?, ?, ?, ?)`,
    [
      moduleId,
      userId,
      scored.score_percent,
      scored.passed ? 1 : 0,
      JSON.stringify(answerPayload),
    ]
  );

  let awarded = null;
  if (scored.passed && module.awards_qualification_id) {
    awarded = await Qualification.awardToUser({
      userId,
      qualificationId: module.awards_qualification_id,
      awardedAt: asOf,
      awardedBy: null,
      asOf,
      // Module validity wins when set; otherwise the qualification's own months apply.
      validityMonths: module.validity_months,
    });
  }

  const [rows] = await pool.execute(
    `SELECT id, module_id, user_id, score_percent, passed, answers, attempted_at
     FROM training_attempts WHERE id = ? LIMIT 1`,
    [result.insertId]
  );
  const attempt = rows[0];

  return {
    attempt: {
      id: attempt.id,
      module_id: attempt.module_id,
      user_id: attempt.user_id,
      score_percent: Number(attempt.score_percent),
      passed: Number(attempt.passed) === 1,
      answers:
        typeof attempt.answers === 'string'
          ? JSON.parse(attempt.answers)
          : attempt.answers,
      attempted_at: attempt.attempted_at,
    },
    score_percent: scored.score_percent,
    passed: scored.passed,
    correct: scored.correct,
    total: scored.total,
    pass_mark_percent: module.pass_mark_percent,
    qualification_awarded: awarded
      ? {
          qualification_id: awarded.qualification_id,
          name: awarded.name,
          awarded_at: awarded.awarded_at,
          expires_at: awarded.expires_at,
        }
      : null,
  };
}

/**
 * True when the volunteer has a non-expired pass for this module.
 * If the module awards a qualification, the award must still be valid asOf.
 */
async function hasValidPass(userId, moduleId, asOf = new Date()) {
  const module = await findById(moduleId, { includeInactive: true });
  if (!module) return false;

  const attempts = await findAttemptsForUser(userId, moduleId);
  if (!attempts.some((a) => a.passed)) return false;

  if (!module.awards_qualification_id) return true;

  const held = await Qualification.findByUserId(userId);
  const award = held.find(
    (row) => Number(row.qualification_id) === Number(module.awards_qualification_id)
  );
  if (!award) return false;
  const expires = Qualification.toDateOnly(award.expires_at);
  const asOfDay = Qualification.toDateOnly(asOf);
  if (expires && asOfDay && expires < asOfDay) return false;
  return true;
}

module.exports = {
  scoreAttempt,
  normalizeValidityMonths,
  create,
  findById,
  findAll,
  update,
  remove,
  findQuestions,
  replaceQuestions,
  findAttemptsForUser,
  recordAttempt,
  hasValidPass,
};
