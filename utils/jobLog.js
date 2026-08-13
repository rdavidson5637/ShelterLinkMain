'use strict';

const { pool } = require('../config/database');

async function recordJobRun(jobName, status, detail = null) {
  const sql = `
    INSERT INTO job_runs (job_name, ran_at, status, detail)
    VALUES (?, NOW(), ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    jobName,
    status === 'error' ? 'error' : 'ok',
    detail == null ? null : String(detail),
  ]);
  return result.insertId;
}

module.exports = {
  recordJobRun,
};
