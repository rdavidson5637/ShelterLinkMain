/**
 * Shared dashboard figure: sentence-case label over a tabular number.
 * Until a value is set it shows a skeleton the size of the number, never a
 * dash. Setting textContent on the value element replaces the skeleton.
 */

export function createStatCard({ label, valueId, value = null, badgeId } = {}) {
  const article = document.createElement('article');
  article.className = 'stat-card';

  const heading = document.createElement('h3');
  heading.textContent = label || '';

  const valueEl = document.createElement('p');
  if (valueId) valueEl.id = valueId;
  valueEl.className = 'stat-number';
  if (value == null) {
    const skeleton = document.createElement('span');
    skeleton.className = 'skeleton skeleton-figure';
    skeleton.setAttribute('aria-hidden', 'true');
    valueEl.appendChild(skeleton);
  } else {
    valueEl.textContent = value;
  }
  article.append(heading, valueEl);

  if (badgeId) {
    const badge = document.createElement('span');
    badge.id = badgeId;
    badge.className = 'badge';
    badge.hidden = true;
    badge.setAttribute('aria-hidden', 'true');
    article.appendChild(badge);
  }

  return article;
}

export function renderStatCards(container, cards = []) {
  if (!container) return [];
  container.innerHTML = '';
  return cards.map((card) => {
    const el = createStatCard(card);
    container.appendChild(el);
    return el;
  });
}
