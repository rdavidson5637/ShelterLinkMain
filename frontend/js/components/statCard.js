/**
 * Shared dashboard metric card: small uppercase label, large tabular number.
 */

export function createStatCard({ label, valueId, value = '—', badgeId } = {}) {
  const article = document.createElement('article');
  article.className = 'stat-card';

  const heading = document.createElement('h3');
  heading.textContent = label || '';

  const valueEl = document.createElement('p');
  if (valueId) valueEl.id = valueId;
  valueEl.className = 'stat-number';
  valueEl.textContent = value;
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
