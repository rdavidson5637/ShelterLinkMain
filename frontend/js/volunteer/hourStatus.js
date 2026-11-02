export function hourMatchesStatus(approved, status) {
  if (status === 'approved') return Boolean(approved);
  if (status === 'pending') return !approved;
  return true;
}
