'use strict';

/**
 * One-off shelter events (SL-DAY-20).
 * Staff create dated events with place and capacity; volunteers sign up and cancel.
 * Staff may email active attendees on an explicit click. Separate from shifts.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 4000;
const LOCATION_MAX = 200;
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 9999;

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

function normaliseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail(400, `Invalid ${label}`);
  }
  return id;
}

function normaliseTitle(raw) {
  const title = String(raw == null ? '' : raw).trim();
  if (!title) throw fail(400, 'Add a short title.');
  if (title.length > TITLE_MAX) {
    throw fail(400, `Title must be ${TITLE_MAX} characters or fewer.`);
  }
  return title;
}

function normaliseDescription(raw) {
  const description = String(raw == null ? '' : raw).trim();
  if (!description) throw fail(400, 'Add a short description.');
  if (description.length > DESCRIPTION_MAX) {
    throw fail(400, `Description must be ${DESCRIPTION_MAX} characters or fewer.`);
  }
  return description;
}

function normaliseLocation(raw) {
  const location = String(raw == null ? '' : raw).trim();
  if (!location) throw fail(400, 'Add a place or meeting point.');
  if (location.length > LOCATION_MAX) {
    throw fail(400, `Place must be ${LOCATION_MAX} characters or fewer.`);
  }
  return location;
}

function normaliseCapacity(raw) {
  const capacity = Number(raw);
  if (!Number.isInteger(capacity) || capacity < CAPACITY_MIN || capacity > CAPACITY_MAX) {
    throw fail(400, `Capacity must be a whole number from ${CAPACITY_MIN} to ${CAPACITY_MAX}.`);
  }
  return capacity;
}

function normaliseDate(raw, label, { required = false } = {}) {
  if (raw == null || raw === '') {
    if (required) throw fail(400, `${label} is required`);
    return null;
  }
  const text = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw fail(400, `${label} must be YYYY-MM-DD`);
  }
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw fail(400, `${label} is not a valid date`);
  }
  return text;
}

function displayName(row) {
  if (!row) return null;
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return fromParts || row.name || null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function mapRow(row, { signupCount = null, mySignup = null } = {}) {
  if (!row) return null;
  const archived = Boolean(row.archived_at);
  const eventDate = row.event_date ? String(row.event_date).slice(0, 10) : null;
  const past = !archived && eventDate != null && eventDate < todayIso();
  const spotsFilled =
    signupCount != null
      ? Number(signupCount) || 0
      : row.signup_count != null
        ? Number(row.signup_count) || 0
        : 0;
  const capacity = Number(row.capacity) || 0;
  const signedUp =
    mySignup != null
      ? Boolean(mySignup)
      : row.my_signup != null
        ? Number(row.my_signup) > 0
        : false;
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    event_date: eventDate,
    location: row.location,
    capacity,
    spots_filled: spotsFilled,
    spots_remaining: Math.max(0, capacity - spotsFilled),
    my_signup: signedUp,
    archived_at: row.archived_at || null,
    emailed_at: row.emailed_at || null,
    email_count: Number(row.email_count) || 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    author_name: displayName({
      first_name: row.author_first_name,
      last_name: row.author_last_name,
      name: row.author_name,
    }),
    status: archived ? 'archived' : past ? 'past' : 'upcoming',
  };
}

const SELECT_SQL = `
  SELECT
    e.id,
    e.title,
    e.description,
    e.event_date,
    e.location,
    e.capacity,
    e.archived_at,
    e.emailed_at,
    e.email_count,
    e.created_by,
    e.created_at,
    e.updated_at,
    u.first_name AS author_first_name,
    u.last_name AS author_last_name,
    u.name AS author_name,
    (
      SELECT COUNT(*)::int
      FROM shelter_event_signups s
      WHERE s.event_id = e.id
        AND s.cancelled_at IS NULL
    ) AS signup_count
  FROM shelter_events e
  LEFT JOIN users u ON u.user_id = e.created_by
`;

async function getById(id, { forUserId = null } = {}) {
  requireShelterId();
  const eventId = normaliseId(id, 'event');
  const [rows] = await pool.execute(
    `${SELECT_SQL}
      WHERE e.id = ?
      LIMIT 1`,
    [eventId]
  );
  const row = rows[0] || null;
  if (!row) return null;
  let mySignup = false;
  if (forUserId != null) {
    const userId = normaliseId(forUserId, 'user');
    const [signupRows] = await pool.execute(
      `SELECT id
         FROM shelter_event_signups
        WHERE event_id = ?
          AND user_id = ?
          AND cancelled_at IS NULL
        LIMIT 1`,
      [eventId, userId]
    );
    mySignup = Boolean(signupRows[0]);
  }
  return mapRow(row, { mySignup });
}

/**
 * List events for the current shelter.
 * @param {{ upcomingOnly?: boolean, includeArchived?: boolean, forUserId?: number|null }} opts
 */
async function listEvents({
  upcomingOnly = true,
  includeArchived = false,
  forUserId = null,
} = {}) {
  requireShelterId();
  const where = [];
  if (upcomingOnly) {
    where.push('e.archived_at IS NULL');
    where.push('e.event_date >= CURRENT_DATE');
  } else if (!includeArchived) {
    where.push('e.archived_at IS NULL');
  }
  const order = upcomingOnly
    ? 'ORDER BY e.event_date ASC, e.id ASC'
    : 'ORDER BY e.event_date DESC, e.id DESC';
  const sql = `${SELECT_SQL}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ${order}`;
  const [rows] = await pool.execute(sql);

  let mySignupIds = new Set();
  if (forUserId != null && rows.length) {
    const userId = normaliseId(forUserId, 'user');
    const [signupRows] = await pool.execute(
      `SELECT event_id
         FROM shelter_event_signups
        WHERE user_id = ?
          AND cancelled_at IS NULL`,
      [userId]
    );
    mySignupIds = new Set(signupRows.map((r) => Number(r.event_id)));
  }

  return rows.map((row) =>
    mapRow(row, {
      mySignup: forUserId != null ? mySignupIds.has(Number(row.id)) : false,
    })
  );
}

async function create({
  title,
  description,
  eventDate,
  location,
  capacity,
  createdBy,
} = {}) {
  requireShelterId();
  const cleanTitle = normaliseTitle(title);
  const cleanDescription = normaliseDescription(description);
  const date = normaliseDate(eventDate, 'event_date', { required: true });
  const cleanLocation = normaliseLocation(location);
  const cleanCapacity = normaliseCapacity(capacity);
  const authorId =
    createdBy == null || createdBy === ''
      ? null
      : normaliseId(createdBy, 'created_by');

  const [result] = await pool.execute(
    `INSERT INTO shelter_events
       (title, description, event_date, location, capacity, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [cleanTitle, cleanDescription, date, cleanLocation, cleanCapacity, authorId]
  );
  return getById(result.insertId);
}

async function update(
  id,
  { title, description, eventDate, location, capacity } = {}
) {
  requireShelterId();
  const existing = await getById(id);
  if (!existing) throw fail(404, 'Event not found');
  if (existing.archived_at) {
    throw fail(400, 'Archived events cannot be edited. Create a new one.');
  }

  const cleanTitle = title !== undefined ? normaliseTitle(title) : existing.title;
  const cleanDescription =
    description !== undefined
      ? normaliseDescription(description)
      : existing.description;
  const date =
    eventDate !== undefined
      ? normaliseDate(eventDate, 'event_date', { required: true })
      : existing.event_date;
  const cleanLocation =
    location !== undefined ? normaliseLocation(location) : existing.location;
  const cleanCapacity =
    capacity !== undefined ? normaliseCapacity(capacity) : existing.capacity;

  if (cleanCapacity < existing.spots_filled) {
    throw fail(
      400,
      `Capacity cannot be below the ${existing.spots_filled} people already signed up.`
    );
  }

  await pool.execute(
    `UPDATE shelter_events
        SET title = ?,
            description = ?,
            event_date = ?,
            location = ?,
            capacity = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [cleanTitle, cleanDescription, date, cleanLocation, cleanCapacity, existing.id]
  );
  return getById(existing.id);
}

async function archive(id) {
  requireShelterId();
  const existing = await getById(id);
  if (!existing) throw fail(404, 'Event not found');
  if (existing.archived_at) return existing;

  await pool.execute(
    `UPDATE shelter_events
        SET archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [existing.id]
  );
  return getById(existing.id);
}

async function assertApprovedVolunteer(userId) {
  const id = normaliseId(userId, 'user');
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.role, COALESCE(vp.approved, 0) AS approved
       FROM users u
       LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.user_id = ?
        AND u.archived_at IS NULL
        AND u.anonymised_at IS NULL
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw fail(404, 'Volunteer not found');
  if (row.role !== 'volunteer') {
    throw fail(403, 'Only volunteers can sign up for shelter events.');
  }
  if (Number(row.approved) !== 1) {
    throw fail(403, 'Your volunteer profile must be approved before signing up.');
  }
  return id;
}

async function signUp(eventId, userId) {
  requireShelterId();
  const event = await getById(eventId, { forUserId: userId });
  if (!event) throw fail(404, 'Event not found');
  if (event.archived_at) throw fail(400, 'This event is no longer open for sign-up.');
  if (event.status === 'past') throw fail(400, 'This event has already passed.');
  if (event.my_signup) return event;

  const volunteerId = await assertApprovedVolunteer(userId);

  if (event.spots_filled >= event.capacity) {
    throw fail(400, 'This event is full.');
  }

  const [existingRows] = await pool.execute(
    `SELECT id, cancelled_at
       FROM shelter_event_signups
      WHERE event_id = ?
        AND user_id = ?
      LIMIT 1`,
    [event.id, volunteerId]
  );
  const existing = existingRows[0];

  if (existing && !existing.cancelled_at) {
    return getById(event.id, { forUserId: volunteerId });
  }

  // Re-check capacity under a short transaction-friendly pattern
  const [countRows] = await pool.execute(
    `SELECT COUNT(*)::int AS n
       FROM shelter_event_signups
      WHERE event_id = ?
        AND cancelled_at IS NULL`,
    [event.id]
  );
  const filled = Number(countRows[0]?.n) || 0;
  if (filled >= event.capacity) {
    throw fail(400, 'This event is full.');
  }

  if (existing) {
    await pool.execute(
      `UPDATE shelter_event_signups
          SET cancelled_at = NULL,
              signed_up_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [existing.id]
    );
  } else {
    await pool.execute(
      `INSERT INTO shelter_event_signups (event_id, user_id)
       VALUES (?, ?)`,
      [event.id, volunteerId]
    );
  }

  return getById(event.id, { forUserId: volunteerId });
}

async function cancelSignup(eventId, userId) {
  requireShelterId();
  const event = await getById(eventId, { forUserId: userId });
  if (!event) throw fail(404, 'Event not found');
  const volunteerId = normaliseId(userId, 'user');

  const [rows] = await pool.execute(
    `SELECT id, cancelled_at
       FROM shelter_event_signups
      WHERE event_id = ?
        AND user_id = ?
      LIMIT 1`,
    [event.id, volunteerId]
  );
  const row = rows[0];
  if (!row || row.cancelled_at) {
    return getById(event.id, { forUserId: volunteerId });
  }

  await pool.execute(
    `UPDATE shelter_event_signups
        SET cancelled_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [row.id]
  );
  return getById(event.id, { forUserId: volunteerId });
}

async function listAttendees(eventId) {
  requireShelterId();
  const event = await getById(eventId);
  if (!event) throw fail(404, 'Event not found');

  const [rows] = await pool.execute(
    `SELECT
        s.id,
        s.user_id,
        s.signed_up_at,
        u.email,
        u.first_name,
        u.last_name,
        u.name
      FROM shelter_event_signups s
      INNER JOIN users u ON u.user_id = s.user_id
     WHERE s.event_id = ?
       AND s.cancelled_at IS NULL
     ORDER BY u.last_name, u.first_name, s.id`,
    [event.id]
  );

  return {
    event,
    attendees: rows.map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      email: row.email || null,
      first_name: row.first_name || null,
      last_name: row.last_name || null,
      name: displayName(row),
      signed_up_at: row.signed_up_at || null,
    })),
  };
}

/**
 * Active attendees with an email address (for staff email click).
 */
async function listAttendeeRecipients(eventId) {
  const { event, attendees } = await listAttendees(eventId);
  const recipients = attendees.filter(
    (a) => a.email && String(a.email).trim() !== ''
  );
  return { event, recipients };
}

async function markEmailed(id, recipientCount) {
  requireShelterId();
  const eventId = normaliseId(id, 'event');
  const count = Math.max(0, Number(recipientCount) || 0);
  await pool.execute(
    `UPDATE shelter_events
        SET emailed_at = CURRENT_TIMESTAMP,
            email_count = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [count, eventId]
  );
  return getById(eventId);
}

module.exports = {
  TITLE_MAX,
  DESCRIPTION_MAX,
  LOCATION_MAX,
  CAPACITY_MIN,
  CAPACITY_MAX,
  listEvents,
  getById,
  create,
  update,
  archive,
  signUp,
  cancelSignup,
  listAttendees,
  listAttendeeRecipients,
  markEmailed,
};
