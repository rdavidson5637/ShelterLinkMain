'use strict';

/**
 * New-shelter setup checklist (SL-LATER-17).
 * Progress is derived from real shelter data, not a manual tick list.
 */

const { pool } = require('../config/database');
const {
  currentShelterId,
  runWithoutShelter,
} = require('../utils/shelterContext');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ITEM_DEFS = [
  {
    id: 'branding',
    title: 'Shelter branding',
    detail: 'Set an accent colour or upload a logo.',
    href: '/pages/admin/branding.html',
  },
  {
    id: 'booking_policy',
    title: 'Booking policy',
    detail: 'Choose whether every booking waits for approval, or trusted volunteers book instantly.',
    href: '/pages/admin/review-applications.html',
  },
  {
    id: 'minimum_age',
    title: 'Minimum age',
    detail: 'Save a minimum volunteer age, or confirm there is no minimum.',
    href: '/pages/admin/waivers.html',
  },
  {
    id: 'first_shift',
    title: 'First shift',
    detail: 'Publish at least one opportunity.',
    href: '/pages/admin/create-opportunity.html',
  },
  {
    id: 'invite_staff',
    title: 'Invite staff',
    detail: 'Invite another staff member or admin, or have a second team account.',
    href: '/pages/admin/team.html',
  },
  {
    id: 'privacy_notice',
    title: 'Privacy contact',
    detail: 'Set the privacy contact email shown for volunteer data requests.',
    href: '/pages/admin/privacy.html',
  },
];

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

function normaliseEmail(raw) {
  if (raw == null) return null;
  const email = String(raw).trim().toLowerCase();
  if (!email) return null;
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw fail(400, 'Enter an email address like name@example.org.');
  }
  return email;
}

async function readFlags(shelterId) {
  const [[shelterRows], [policyRows], [ageRows], [oppRows], [inviteRows], [staffRows]] =
    await Promise.all([
      pool.execute(
        `SELECT primary_colour, privacy_contact_email, setup_checklist_dismissed_at,
                ( (logo IS NOT NULL AND octet_length(logo) > 0)
                  OR (logo_storage_key IS NOT NULL AND length(logo_storage_key) > 0)
                ) AS has_logo
           FROM shelters
          WHERE id = ?
          LIMIT 1`,
        [shelterId]
      ),
      pool.execute(
        `SELECT 1 AS ok
           FROM shelter_booking_policy
          WHERE shelter_id = ?
          LIMIT 1`,
        [shelterId]
      ),
      pool.execute(
        `SELECT 1 AS ok
           FROM shelter_settings
          WHERE shelter_id = ?
          LIMIT 1`,
        [shelterId]
      ),
      pool.execute(
        `SELECT COUNT(*)::int AS count
           FROM opportunities
          WHERE shelter_id = ?`,
        [shelterId]
      ),
      pool.execute(
        `SELECT COUNT(*)::int AS count
           FROM admin_invites
          WHERE shelter_id = ?`,
        [shelterId]
      ),
      pool.execute(
        `SELECT COUNT(*)::int AS count
           FROM users
          WHERE shelter_id = ?
            AND role IN ('staff', 'admin')
            AND anonymised_at IS NULL`,
        [shelterId]
      ),
    ]);

  const shelter = shelterRows[0] || null;
  if (!shelter) throw fail(404, 'Shelter not found');

  return {
    branding: Boolean(shelter.primary_colour) || Boolean(shelter.has_logo),
    booking_policy: policyRows.length > 0,
    minimum_age: ageRows.length > 0,
    first_shift: Number(oppRows[0]?.count || 0) > 0,
    invite_staff:
      Number(inviteRows[0]?.count || 0) > 0 || Number(staffRows[0]?.count || 0) > 1,
    privacy_notice: Boolean(
      shelter.privacy_contact_email && String(shelter.privacy_contact_email).trim()
    ),
    privacy_contact_email: shelter.privacy_contact_email
      ? String(shelter.privacy_contact_email).trim().toLowerCase()
      : null,
    dismissed_at: shelter.setup_checklist_dismissed_at || null,
  };
}

function buildChecklist(flags) {
  const items = ITEM_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    detail: def.detail,
    href: def.href,
    done: Boolean(flags[def.id]),
  }));
  const doneCount = items.filter((item) => item.done).length;
  const complete = doneCount === items.length;
  const dismissed = Boolean(flags.dismissed_at);
  return {
    items,
    doneCount,
    total: items.length,
    complete,
    dismissed,
    dismissed_at: flags.dismissed_at,
    visible: !dismissed,
    privacy_contact_email: flags.privacy_contact_email,
  };
}

async function getChecklist() {
  const shelterId = requireShelterId();
  return buildChecklist(await readFlags(shelterId));
}

async function dismissChecklist() {
  const shelterId = requireShelterId();
  const checklist = buildChecklist(await readFlags(shelterId));
  if (!checklist.complete) {
    throw fail(400, 'Finish every setup step before dismissing the checklist.');
  }
  if (checklist.dismissed) return checklist;

  await runWithoutShelter(() =>
    pool.execute(
      `UPDATE shelters
          SET setup_checklist_dismissed_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND setup_checklist_dismissed_at IS NULL`,
      [shelterId]
    )
  );

  return getChecklist();
}

async function getPrivacyContact() {
  const shelterId = requireShelterId();
  const flags = await readFlags(shelterId);
  return { privacy_contact_email: flags.privacy_contact_email };
}

async function setPrivacyContact(rawEmail) {
  const shelterId = requireShelterId();
  const email = normaliseEmail(rawEmail);

  await runWithoutShelter(() =>
    pool.execute(
      `UPDATE shelters SET privacy_contact_email = ? WHERE id = ?`,
      [email, shelterId]
    )
  );

  return getPrivacyContact();
}

module.exports = {
  ITEM_DEFS,
  getChecklist,
  dismissChecklist,
  getPrivacyContact,
  setPrivacyContact,
  normaliseEmail,
};
