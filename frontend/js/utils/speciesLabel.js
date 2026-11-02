const SPECIES_LABELS = {
  dog: 'Dog',
  cat: 'Cat',
  small_animal: 'Small animal',
  other: 'Other',
};

/** The word shown for an animal species. The stored value stays dog, cat, small_animal, or other. */
export function speciesLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (SPECIES_LABELS[key]) return SPECIES_LABELS[key];
  return key.replace(/_/g, ' ');
}
