'use strict';

/**
 * The one users lookup the platform owner's queue may make: which of these
 * email addresses already have a ShelterLink account. It answers yes or no
 * per address and reads nothing else from users (no name, role, shelter or
 * any volunteer data). Used to warn the owner at Approve, because accepting
 * an invite for an address that already has an account is refused.
 *
 * The caller runs this outside shelter context.
 */
async function emailsWithAccounts(db, emails) {
  const wanted = [...new Set((emails || [])
    .filter((e) => typeof e === 'string' && e.trim())
    .map((e) => e.trim().toLowerCase()))];
  if (!wanted.length) return new Set();
  const [rows] = await db.execute(
    'SELECT DISTINCT lower(email) AS email FROM users WHERE lower(email) = ANY(?::text[])',
    [wanted]
  );
  return new Set(rows.map((row) => String(row.email)));
}

module.exports = { emailsWithAccounts };
