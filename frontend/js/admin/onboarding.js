import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';

const messageEl = document.getElementById('message');
const countsEl = document.getElementById('counts');
const sectionsEl = document.getElementById('pipelineSections');
const logoutButton = document.getElementById('logoutButton');

const STAGE_LABELS = {
  needs_profile: 'Needs profile',
  awaiting_approval: 'Awaiting approval',
  needs_waiver: 'Needs waiver',
  needs_references: 'Needs references',
  reference_flagged: 'Reference flagged — needs staff review',
  needs_accessni: 'Needs AccessNI',
  ready: 'Ready',
};

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  messageEl.innerHTML = `<p class="${type === 'error' ? 'error' : 'success'}">${text}</p>`;
}

function volunteerName(v) {
  return `${v.first_name || ''} ${v.last_name || ''}`.trim() || v.email || `User ${v.user_id}`;
}

async function loadPipeline() {
  const res = await apiRequest('/vetting/admin/pipeline');
  if (!res.ok) {
    sectionsEl.innerHTML = '<p class="error">Unable to load pipeline.</p>';
    return;
  }
  const data = await res.json();
  const stages = data.stages || Object.keys(STAGE_LABELS);
  const pipeline = data.pipeline || {};
  const counts = data.counts || {};

  countsEl.innerHTML = '';
  stages.forEach((stage) => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${STAGE_LABELS[stage] || stage}:</strong> ${counts[stage] || 0}`;
    countsEl.appendChild(p);
  });

  sectionsEl.innerHTML = '';
  stages.forEach((stage) => {
    const people = pipeline[stage] || [];
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = `${STAGE_LABELS[stage] || stage} (${people.length})`;
    section.appendChild(h2);
    if (!people.length) {
      const empty = document.createElement('p');
      empty.textContent = 'None';
      section.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      people.forEach((v) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `/pages/admin/volunteers.html?user=${encodeURIComponent(v.user_id)}`;
        a.textContent = volunteerName(v);
        li.appendChild(a);
        li.appendChild(document.createTextNode(` — ${v.email || ''}`));
        ul.appendChild(li);
      });
      section.appendChild(ul);
    }
    sectionsEl.appendChild(section);
  });
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return;
  }
  applyRoleVisibility(user);
  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
  try {
    await loadPipeline();
  } catch (err) {
    console.error(err);
    setMessage('error', 'Failed to load onboarding pipeline.');
  }
}

init();
