/**
 * Maps the close-shift dialog onto the existing DELETE calls.
 * A series offers three choices. A single shift offers two.
 * Keep, Escape, and a click outside the card send no request.
 */

export function closeShiftChoices(partOfSeries) {
  if (partOfSeries) {
    return [
      { id: 'one', label: 'Just this shift' },
      { id: 'series', label: 'This and the whole series' },
      { id: 'keep', label: 'Keep it' },
    ];
  }
  return [
    { id: 'one', label: 'Close this shift' },
    { id: 'keep', label: 'Keep it' },
  ];
}

/**
 * confirm is the strong action: the series when there is one, otherwise this shift.
 * extra is "Just this shift" and only exists for a series.
 */
export function choiceFromDialog(result, partOfSeries) {
  if (result === 'extra' && partOfSeries) return 'one';
  if (result === 'confirm') return partOfSeries ? 'series' : 'one';
  return 'keep';
}

export function closeShiftEndpoint(choice, opportunityId) {
  const id = Number(opportunityId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (choice === 'one') return `/opportunities/${id}`;
  if (choice === 'series') return `/opportunities/${id}?series=true`;
  return null;
}
