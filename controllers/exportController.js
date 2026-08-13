const { pool } = require('../config/database');
const { convertToCSV } = require('../utils/csvExport');
const CustomField = require('../models/CustomField');
const { isAdminUser } = require('../middleware/auth');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function isAdmin(req) {
  // CSV export remains admin-only.
  return isAdminUser(req);
}

function setCsvHeaders(res, filename) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

async function fetchHoursForExport({ userId = null, startDate, endDate }) {
  const whereClauses = [];
  const params = [];

  if (userId) {
    whereClauses.push('vh.user_id = ?');
    params.push(userId);
  }
  if (startDate) {
    whereClauses.push('vh.date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    whereClauses.push('vh.date <= ?');
    params.push(endDate);
  }

  const sql = `
    SELECT
      u.first_name,
      u.last_name,
      u.email,
      o.title AS opportunity_title,
      vh.date AS \`date\`,
      vh.hours,
      vh.approved
    FROM volunteer_hours vh
    LEFT JOIN users u ON u.user_id = vh.user_id
    LEFT JOIN opportunities o ON o.opportunity_id = vh.opportunity_id
    ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
    ORDER BY vh.date DESC
  `;

  const [rows] = await pool.execute(sql, params);
  return rows.map((row) => ({
    volunteer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    email: row.email || '',
    opportunity_title: row.opportunity_title || '',
    date: row.date || '',
    hours: row.hours ?? 0,
    approved: row.approved ? 'Yes' : 'No',
  }));
}

async function exportVolunteers(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sql = `
      SELECT
        u.user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        COALESCE(vp.approved, 0) AS approved,
        COALESCE(SUM(vh.hours), 0) AS total_hours,
        u.created_at
      FROM users u
      LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      LEFT JOIN volunteer_hours vh ON vh.user_id = u.user_id AND vh.approved = 1
      WHERE u.role = 'volunteer'
      GROUP BY u.user_id, u.first_name, u.last_name, u.email, u.phone, vp.approved, u.created_at
      ORDER BY u.created_at DESC
    `;

    const [rows] = await pool.execute(sql);

    const { fields: customFields, byUser } = await CustomField.findAllValuesGroupedByUser();
    const customColumns = customFields.map((f) => f.label);

    const data = rows.map((row) => {
      const base = {
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        email: row.email || '',
        phone: row.phone || '',
        approved: row.approved || 0,
        total_hours: row.total_hours || 0,
        created_at: row.created_at || '',
      };

      const values = byUser.get(row.user_id) || {};
      for (const field of customFields) {
        const raw = values[field.id];
        if (field.field_type === 'checkbox') {
          base[field.label] = raw === '1' || raw === 1 || raw === true ? 'Yes' : 'No';
        } else {
          base[field.label] = raw != null ? String(raw) : '';
        }
      }
      return base;
    });

    const fields = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'approved',
      'total_hours',
      'created_at',
      ...customColumns,
    ];
    const csv = convertToCSV(data, fields);

    setCsvHeaders(res, 'volunteers.csv');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[Export] exportVolunteers error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function exportHours(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const isUserAdmin = isAdmin(req);
    const { userId: queryUserId, startDate, endDate } = req.query || {};
    const scopedUserId = isUserAdmin ? (queryUserId || null) : req.session.userId;

    const data = await fetchHoursForExport({
      userId: scopedUserId,
      startDate,
      endDate,
    });

    const fields = ['volunteer_name', 'email', 'opportunity_title', 'date', 'hours', 'approved'];
    const csv = convertToCSV(data, fields);

    setCsvHeaders(res, 'hours.csv');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[Export] exportHours error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function exportVolunteerOwnHours(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const data = await fetchHoursForExport({
      userId: req.session.userId,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
    });

    const fields = ['volunteer_name', 'email', 'opportunity_title', 'date', 'hours', 'approved'];
    const csv = convertToCSV(data, fields);

    setCsvHeaders(res, 'my-hours.csv');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[Export] exportVolunteerOwnHours error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function exportCommunityService(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sql = `
      SELECT
        u.first_name,
        u.last_name,
        u.email,
        vp.required_hours AS target,
        COALESCE(SUM(CASE WHEN vh.approved = 1 THEN vh.hours ELSE 0 END), 0) AS approved_hours,
        CASE
          WHEN vp.required_hours IS NOT NULL
            AND COALESCE(SUM(CASE WHEN vh.approved = 1 THEN vh.hours ELSE 0 END), 0) >= vp.required_hours
          THEN MAX(CASE WHEN vh.approved = 1 THEN vh.date END)
          ELSE NULL
        END AS completion_date
      FROM users u
      INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      LEFT JOIN volunteer_hours vh ON vh.user_id = u.user_id
      WHERE u.role = 'volunteer'
        AND vp.volunteer_type = 'community_service'
      GROUP BY u.user_id, u.first_name, u.last_name, u.email, vp.required_hours
      ORDER BY u.last_name, u.first_name
    `;

    const [rows] = await pool.execute(sql);
    const data = rows.map((row) => ({
      volunteer: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      email: row.email || '',
      target: row.target != null ? Number(row.target) : '',
      approved_hours: Number(row.approved_hours) || 0,
      completion_date: row.completion_date || '',
    }));

    const fields = ['volunteer', 'email', 'target', 'approved_hours', 'completion_date'];
    const csv = convertToCSV(data, fields);

    setCsvHeaders(res, 'community-service.csv');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[Export] exportCommunityService error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  exportVolunteers,
  exportHours,
  exportVolunteerOwnHours,
  exportCommunityService,
};
