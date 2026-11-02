function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function dedupeMissing(missing) {
  const namedForAnimal = new Set(missing.filter((item) => item.animalName).map((item) => item.id));
  const seen = new Set();
  const unique = [];
  for (const item of missing) {
    if (!item.animalName && namedForAnimal.has(item.id)) continue;
    const key = `${item.id}:${item.animalName || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function holdsQualification(heldById, qualificationId, asOf) {
  const award = heldById.get(Number(qualificationId));
  if (!award) return false;
  const expires = toDateOnly(award.expires_at);
  if (!expires) return true;
  return expires >= toDateOnly(asOf);
}

/**
 * Shift requirements and each animal's required qualification.
 * The apply API refuses both. An expired award counts as missing.
 */
export function missingQualifications(opportunity, held = [], asOf = new Date()) {
  const heldById = new Map((held || []).map((item) => [Number(item.qualification_id), item]));
  const missing = [];

  for (const req of opportunity?.required_qualifications || []) {
    if (holdsQualification(heldById, req.id, asOf)) continue;
    missing.push({ id: Number(req.id), name: req.name || 'a qualification' });
  }

  for (const animal of opportunity?.animals || []) {
    if (animal.requires_qualification_id == null || animal.requires_qualification_id === '') continue;
    if (holdsQualification(heldById, animal.requires_qualification_id, asOf)) continue;
    missing.push({
      id: Number(animal.requires_qualification_id),
      name: animal.requires_qualification_name || 'a qualification',
      animalName: animal.name || 'this animal',
    });
  }

  return dedupeMissing(missing);
}

export function missingQualificationLabel(missing = []) {
  const names = [...new Set(missing.map((item) => item.name).filter(Boolean))];
  if (names.length === 0) return '';
  if (names.length === 1) return `You need ${names[0]} first.`;
  const last = names[names.length - 1];
  return `You need ${names.slice(0, -1).join(', ')} and ${last} first.`;
}

export function missingQualificationSentence(missing = []) {
  const parts = missing.map((item) =>
    item.animalName ? `${item.name} for ${item.animalName}` : item.name
  );
  if (parts.length === 0) return '';
  if (parts.length === 1) return `You need ${parts[0]} before you can apply.`;
  const last = parts[parts.length - 1];
  return `You need ${parts.slice(0, -1).join(', ')} and ${last} before you can apply.`;
}
