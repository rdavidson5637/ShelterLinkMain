/**
 * Empty-board copy for the public open-shifts page.
 * Names the shelter when known so a blank feed still reads as intentional.
 */
export function publicOpportunitiesEmptyCopy(shelterName) {
  const name = String(shelterName || '').trim() || 'this shelter';
  return {
    title: `No open shifts at ${name}`,
    body: `${name} has nothing listed right now. Check back soon, or create an account so you are ready when a shift opens.`,
  };
}
