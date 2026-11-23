import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout } from '../auth.js';

const messageEl = document.getElementById('message');
const moduleList = document.getElementById('moduleList');
const moduleListSection = document.getElementById('moduleListSection');
const moduleDetailSection = document.getElementById('moduleDetailSection');
const moduleTitle = document.getElementById('moduleTitle');
const moduleMeta = document.getElementById('moduleMeta');
const moduleContent = document.getElementById('moduleContent');
const quizQuestions = document.getElementById('quizQuestions');
const quizForm = document.getElementById('quizForm');
const attemptResult = document.getElementById('attemptResult');
const backToListButton = document.getElementById('backToListButton');
const logoutButton = document.getElementById('logoutButton');

let modules = [];
let current = null;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const note = document.createElement('p');
  if (tone === 'error') note.className = 'error';
  if (tone === 'success') note.className = 'success';
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function showList() {
  if (moduleListSection) moduleListSection.hidden = false;
  if (moduleDetailSection) moduleDetailSection.hidden = true;
  current = null;
}

function renderList() {
  if (!moduleList) return;
  if (!modules.length) {
    moduleList.textContent = 'No training modules are available yet.';
    return;
  }
  moduleList.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'ruled-list';
  modules.forEach((m) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    const award = m.awards_qualification_name
      ? ` Awards: ${m.awards_qualification_name}.`
      : '';
    btn.textContent = `${m.name} - pass mark ${m.pass_mark_percent}%.${award}`;
    btn.addEventListener('click', () => openModule(m.id));
    li.appendChild(btn);
    ul.appendChild(li);
  });
  moduleList.appendChild(ul);
}

async function openModule(id) {
  setMessage();
  if (attemptResult) {
    attemptResult.hidden = true;
    attemptResult.innerHTML = '';
  }
  const res = await apiRequest(`/training/${id}`, { method: 'GET' });
  if (!res.ok) {
    setMessage('Could not open that module', 'error');
    return;
  }
  current = await res.json();
  if (moduleListSection) moduleListSection.hidden = true;
  if (moduleDetailSection) moduleDetailSection.hidden = false;
  if (moduleTitle) moduleTitle.textContent = current.name || 'Training module';
  if (moduleMeta) {
    const award = current.awards_qualification_name
      ? ` Passing awards “${current.awards_qualification_name}”.`
      : '';
    const passed = current.has_passed ? ' You have already passed this module.' : '';
    moduleMeta.textContent = `Pass mark ${current.pass_mark_percent}%.${award}${passed}`;
  }
  if (moduleContent) {
    moduleContent.textContent = current.content || current.description || 'No reading content.';
    moduleContent.style.whiteSpace = 'pre-wrap';
  }
  if (quizQuestions) {
    quizQuestions.innerHTML = '';
    const questions = Array.isArray(current.questions) ? current.questions : [];
    if (!questions.length) {
      quizQuestions.textContent = 'This module has no questions yet. Check back later.';
      return;
    }
    questions.forEach((q, index) => {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = `Q${index + 1}. ${q.prompt}`;
      fieldset.appendChild(legend);
      (q.choices || []).forEach((choice, choiceIndex) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `q_${q.id}`;
        input.value = String(choiceIndex);
        input.required = true;
        label.append(input, document.createTextNode(` ${choice}`));
        fieldset.appendChild(label);
      });
      quizQuestions.appendChild(fieldset);
    });
  }
}

quizForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!current) return;
  setMessage();
  const answers = (current.questions || []).map((q) => {
    const selected = quizForm.querySelector(`input[name="q_${q.id}"]:checked`);
    return {
      question_id: q.id,
      selected_index: selected ? Number(selected.value) : -1,
    };
  });
  if (answers.some((a) => a.selected_index < 0)) {
    setMessage('Answer every question before submitting', 'error');
    return;
  }

  const res = await apiRequest(`/training/${current.id}/attempts`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage(body.error || 'Could not submit answers', 'error');
    return;
  }

  if (attemptResult) {
    attemptResult.hidden = false;
    const lines = [
      `Score: ${body.score_percent}% (${body.correct}/${body.total}). Pass mark: ${body.pass_mark_percent}%.`,
      body.passed ? 'Result: passed.' : 'Result: not passed. You can try again.',
    ];
    if (body.qualification_awarded) {
      lines.push(`Qualification awarded: ${body.qualification_awarded.name}.`);
    }
    attemptResult.replaceChildren(
      ...lines.map((text) => {
        const p = document.createElement('p');
        p.className = body.passed ? 'success' : '';
        p.textContent = text;
        return p;
      })
    );
  }
  setMessage(body.passed ? 'Module passed' : 'Below the pass mark', body.passed ? 'success' : 'error');
});

backToListButton?.addEventListener('click', () => {
  setMessage();
  showList();
  loadModules();
});
logoutButton?.addEventListener('click', () => logout());

async function loadModules() {
  const res = await apiRequest('/training', { method: 'GET' });
  if (!res.ok) throw new Error('Could not load training modules');
  modules = await res.json();
  renderList();
}

(async function init() {
  requireAuth();
  const user = await checkAuth();
  if (!user) {
    window.location.href = '/pages/login.html';
    return;
  }
  try {
    await loadModules();
  } catch (err) {
    setMessage(err.message || 'Failed to load', 'error');
  }
})();
