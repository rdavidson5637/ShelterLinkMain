/**
 * Shift skills eligibility helpers (SL-DAY-16).
 * Skills are the shelter's own qualification catalog: dog walking, cattery,
 * reception, and so on. Required on a shift; recorded on the volunteer.
 */

export function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function isSkillAwardValid(award, asOf = new Date()) {
  if (!award) return false;
  const expires = toDateOnly(award.expires_at);
  if (!expires) return true;
  const day = toDateOnly(asOf);
  return !day || expires >= day;
}

/**
 * required: [{ id, name }]
 * held: [{ qualification_id, expires_at }]
 */
export function getMissingSkills(required = [], held = [], asOf = new Date()) {
  const list = Array.isArray(required) ? required : [];
  if (!list.length) return [];
  const heldById = new Map(
    (Array.isArray(held) ? held : []).map((row) => [Number(row.qualification_id), row])
  );
  return list.filter((req) => !isSkillAwardValid(heldById.get(Number(req.id)), asOf));
}

export function skillIneligibilityReason(missing) {
  if (!Array.isArray(missing) || !missing.length) return null;
  const names = missing.map((q) => q.name).filter(Boolean).join(', ');
  if (!names) return 'Not eligible for this shift. You are missing a required skill.';
  return `Not eligible for this shift. You need: ${names}`;
}

/**
 * Split shifts into those the volunteer can book and those they cannot,
 * with a clear reason for each ineligible row.
 */
export function partitionBySkillEligibility(opportunities, getMissingForOpportunity) {
  const eligible = [];
  const ineligible = [];
  for (const opportunity of Array.isArray(opportunities) ? opportunities : []) {
    const missing = getMissingForOpportunity(opportunity) || [];
    if (missing.length) {
      ineligible.push({
        opportunity,
        missing,
        reason: skillIneligibilityReason(missing),
      });
    } else {
      eligible.push(opportunity);
    }
  }
  return { eligible, ineligible };
}
