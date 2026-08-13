const listEl = document.getElementById('opportunitiesList');

function formatDate(value) {
  if (!value) return 'Date TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleString();
}

async function load() {
  if (!listEl) return;
  try {
    const res = await fetch('/api/public/opportunities', { credentials: 'omit' });
    if (!res.ok) {
      listEl.innerHTML = '<p>Unable to load opportunities right now.</p>';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      listEl.innerHTML = '<p>No open shifts at the moment. Please check back soon.</p>';
      return;
    }
    listEl.innerHTML = '';
    rows.forEach((opp) => {
      const article = document.createElement('article');
      const spots =
        opp.spots_remaining == null
          ? 'Unlimited spots'
          : `${opp.spots_remaining} spot${opp.spots_remaining === 1 ? '' : 's'} remaining`;
      article.innerHTML = `
        <h2>${opp.title || 'Volunteer shift'}</h2>
        <p>${opp.description || ''}</p>
        <p><strong>${formatDate(opp.date || opp.start_date)}</strong> · ${opp.location || 'Location TBA'}</p>
        <p>${spots}</p>
        <a href="/register.html" role="button">Sign up to apply</a>
        <a href="/pages/group-booking.html?opportunity_id=${opp.id}" class="secondary">Book as a group</a>
      `;
      listEl.appendChild(article);
    });
  } catch (error) {
    console.error('[Public] load opportunities error:', error);
    listEl.innerHTML = '<p>Network error while loading opportunities.</p>';
  }
}

document.addEventListener('DOMContentLoaded', load);
