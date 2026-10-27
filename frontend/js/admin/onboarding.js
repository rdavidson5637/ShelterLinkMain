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
  reference_flagged: 'Reference flagged. Needs staff review',
  needs_accessni: 'Needs AccessNI',
  ready: 'Ready',
};

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const note = document.createElement('p');
  note.className = type === 'error' ? 'error' : 'success';
  note.textContent = text;
  messageEl.replaceChildren(note);
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

  countsEl.className = 'figures-strip';
  countsEl.replaceChildren();
  stages.forEach((stage) => {
    const item = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = String(counts[stage] || 0);
    item.append(strong, document.createTextNode(` ${STAGE_LABELS[stage] || stage}`));
    countsEl.appendChild(item);
  });

  sectionsEl.replaceChildren();
  stages.forEach((stage) => {
    const people = pipeline[stage] || [];
    const section = document.createElement('section');
    section.className = 'ruled-panel';
    const header = document.createElement('header');
    header.className = 'ruled-panel-head';
    const h2 = document.createElement('h2');
    h2.textContent = `${STAGE_LABELS[stage] || stage} (${people.length})`;
    header.appendChild(h2);
    section.appendChild(header);
    if (!people.length) {
      const empty = document.createElement('p');
      empty.className = 'ruled-panel-body';
      empty.textContent = 'Nobody is at this stage.';
      section.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'ruled-rows';
      people.forEach((v) => {
        const li = document.createElement('li');
        li.className = 'ruled-row';
        const main = document.createElement('div');
        main.className = 'ruled-row-main';
        const a = document.createElement('a');
        a.className = 'ruled-row-title';
        a.href = `/pages/admin/volunteers.html?user=${encodeURIComponent(v.user_id)}`;
        a.textContent = volunteerName(v);
        main.appendChild(a);
        if (v.email) {
          const detail = document.createElement('span');
          detail.className = 'ruled-row-detail';
          detail.textContent = v.email;
          main.appendChild(detail);
        }
        li.appendChild(main);
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
