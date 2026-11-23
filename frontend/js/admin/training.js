import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';

const form = document.getElementById('moduleForm');
const formTitle = document.getElementById('formTitle');
const idInput = document.getElementById('module_id');
const nameInput = document.getElementById('name');
const descriptionInput = document.getElementById('description');
const contentInput = document.getElementById('content');
const passMarkInput = document.getElementById('pass_mark_percent');
const awardsSelect = document.getElementById('awards_qualification_id');
const activeInput = document.getElementById('active');
const questionsList = document.getElementById('questionsList');
const addQuestionButton = document.getElementById('addQuestionButton');
const saveButton = document.getElementById('saveButton');
const cancelEditButton = document.getElementById('cancelEditButton');
const tableBody = document.getElementById('modulesTableBody');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

let modules = [];
let qualifications = [];
let editingId = null;

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

function emptyQuestion() {
  return { prompt: '', choices: ['', ''], correct_index: 0 };
}

function addQuestionRow(data = emptyQuestion()) {
  if (!questionsList) return;
  const wrap = document.createElement('div');
  wrap.className = 'training-question-editor';
  wrap.style.borderTop = '1px solid var(--pico-muted-border-color, #ccc)';
  wrap.style.paddingTop = '1rem';
  wrap.style.marginTop = '1rem';

  const promptLabel = document.createElement('label');
  promptLabel.textContent = 'Question';
  const promptInput = document.createElement('input');
  promptInput.type = 'text';
  promptInput.className = 'question-prompt';
  promptInput.required = true;
  promptInput.value = data.prompt || '';
  promptLabel.appendChild(promptInput);

  const choicesLabel = document.createElement('label');
  choicesLabel.textContent = 'Choices (one per line, at least two)';
  const choicesArea = document.createElement('textarea');
  choicesArea.className = 'question-choices';
  choicesArea.rows = 3;
  choicesArea.required = true;
  choicesArea.value = (data.choices || []).join('\n');
  choicesLabel.appendChild(choicesArea);

  const correctLabel = document.createElement('label');
  correctLabel.textContent = 'Correct choice number (1 = first line)';
  const correctInput = document.createElement('input');
  correctInput.type = 'number';
  correctInput.min = '1';
  correctInput.className = 'question-correct';
  correctInput.required = true;
  correctInput.value = String((Number(data.correct_index) || 0) + 1);
  correctLabel.appendChild(correctInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'secondary button-small';
  removeBtn.textContent = 'Remove question';
  removeBtn.addEventListener('click', () => wrap.remove());

  wrap.append(promptLabel, choicesLabel, correctLabel, removeBtn);
  questionsList.appendChild(wrap);
}

function readQuestionsFromForm() {
  if (!questionsList) return [];
  return [...questionsList.querySelectorAll('.training-question-editor')].map((wrap) => {
    const prompt = wrap.querySelector('.question-prompt')?.value?.trim() || '';
    const choices = String(wrap.querySelector('.question-choices')?.value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const correctOneBased = Number(wrap.querySelector('.question-correct')?.value);
    return {
      prompt,
      choices,
      correct_index: Number.isFinite(correctOneBased) ? correctOneBased - 1 : 0,
    };
  });
}

function fillAwardsSelect() {
  if (!awardsSelect) return;
  const current = awardsSelect.value;
  awardsSelect.innerHTML = '<option value="">None</option>';
  qualifications.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = String(q.id);
    opt.textContent = q.name;
    awardsSelect.appendChild(opt);
  });
  if (current) awardsSelect.value = current;
}

function resetForm() {
  editingId = null;
  if (idInput) idInput.value = '';
  form?.reset();
  if (passMarkInput) passMarkInput.value = '80';
  if (activeInput) activeInput.checked = true;
  if (questionsList) questionsList.innerHTML = '';
  addQuestionRow();
  if (formTitle) formTitle.textContent = 'Add module';
  if (cancelEditButton) cancelEditButton.hidden = true;
  if (saveButton) saveButton.textContent = 'Save';
}

async function loadModuleForEdit(id) {
  const res = await apiRequest(`/training/${id}`, { method: 'GET' });
  if (!res.ok) throw new Error('Could not load module');
  const data = await res.json();
  editingId = data.id;
  if (idInput) idInput.value = String(data.id);
  if (nameInput) nameInput.value = data.name || '';
  if (descriptionInput) descriptionInput.value = data.description || '';
  if (contentInput) contentInput.value = data.content || '';
  if (passMarkInput) passMarkInput.value = String(data.pass_mark_percent || 80);
  if (awardsSelect) {
    awardsSelect.value = data.awards_qualification_id
      ? String(data.awards_qualification_id)
      : '';
  }
  if (activeInput) activeInput.checked = Boolean(data.active);
  if (questionsList) questionsList.innerHTML = '';
  const qs = Array.isArray(data.questions) ? data.questions : [];
  if (!qs.length) addQuestionRow();
  else qs.forEach((q) => addQuestionRow(q));
  if (formTitle) formTitle.textContent = 'Edit module';
  if (cancelEditButton) cancelEditButton.hidden = false;
  if (saveButton) saveButton.textContent = 'Update';
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTable() {
  if (!tableBody) return;
  if (!modules.length) {
    tableBody.innerHTML = '<tr><td colspan="6">No training modules yet.</td></tr>';
    return;
  }
  tableBody.innerHTML = '';
  modules.forEach((m) => {
    const tr = document.createElement('tr');
    const cells = [
      m.name || '',
      `${m.pass_mark_percent}%`,
      m.awards_qualification_name || '—',
      String(m.question_count ?? 0),
      m.active ? 'Yes' : 'No',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    const actions = document.createElement('td');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    actions.style.flexWrap = 'wrap';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary button-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', async () => {
      setMessage();
      try {
        await loadModuleForEdit(m.id);
      } catch (err) {
        setMessage(err.message || 'Could not load module', 'error');
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteModule(m));

    actions.append(editBtn, deleteBtn);
    tr.appendChild(actions);
    tableBody.appendChild(tr);
  });
}

async function loadData() {
  const [modRes, qualRes] = await Promise.all([
    apiRequest('/training', { method: 'GET' }),
    apiRequest('/qualifications', { method: 'GET' }),
  ]);
  if (!modRes.ok) throw new Error('Could not load training modules');
  if (!qualRes.ok) throw new Error('Could not load qualifications');
  modules = await modRes.json();
  qualifications = await qualRes.json();
  fillAwardsSelect();
  renderTable();
}

async function deleteModule(m) {
  if (!window.confirm(`Delete training module "${m.name}"?`)) return;
  const res = await apiRequest(`/training/${m.id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    setMessage(body.error || 'Delete failed', 'error');
    return;
  }
  setMessage('Module deleted', 'success');
  await loadData();
  if (editingId === m.id) resetForm();
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage();
  const questions = readQuestionsFromForm();
  if (!questions.length) {
    setMessage('Add at least one question', 'error');
    return;
  }
  for (const q of questions) {
    if (!q.prompt || q.choices.length < 2) {
      setMessage('Each question needs a prompt and at least two choices', 'error');
      return;
    }
    if (q.correct_index < 0 || q.correct_index >= q.choices.length) {
      setMessage('Correct choice number must match one of the choice lines', 'error');
      return;
    }
  }

  const payload = {
    name: nameInput?.value?.trim(),
    description: descriptionInput?.value?.trim() || null,
    content: contentInput?.value || '',
    pass_mark_percent: Number(passMarkInput?.value),
    awards_qualification_id: awardsSelect?.value ? Number(awardsSelect.value) : null,
    active: Boolean(activeInput?.checked),
    questions,
  };

  const url = editingId ? `/training/${editingId}` : '/training';
  const method = editingId ? 'PUT' : 'POST';
  const res = await apiRequest(url, { method, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage(body.error || 'Save failed', 'error');
    return;
  }
  setMessage(editingId ? 'Module updated' : 'Module created', 'success');
  resetForm();
  await loadData();
});

addQuestionButton?.addEventListener('click', () => addQuestionRow());
cancelEditButton?.addEventListener('click', () => {
  setMessage();
  resetForm();
});
logoutButton?.addEventListener('click', () => logout());

(async function init() {
  requireAuth();
  const user = await checkAuth();
  if (!user || !isAdminRole(user.role)) {
    window.location.href = '/pages/login.html';
    return;
  }
  resetForm();
  try {
    await loadData();
  } catch (err) {
    setMessage(err.message || 'Failed to load', 'error');
  }
})();
