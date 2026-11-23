import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, isAdminRole, applyRoleVisibility } from '../auth.js';

// Volunteer CSV import (SL-LATER-32). The file is read in the browser and
// sent as text/csv twice: once to check it, once to import it. Nothing is
// kept on the server between the two, so the import always re-checks the
// exact file the admin is looking at.

const MAX_BYTES = 256 * 1024;

const form = document.getElementById('importForm');
const fileInput = document.getElementById('importFile');
const previewButton = document.getElementById('previewButton');
const messageEl = document.getElementById('message');
const previewSection = document.getElementById('previewSection');
const summaryEl = document.getElementById('importSummary');
const previewBody = document.getElementById('previewBody');
const previewCaption = document.getElementById('previewCaption');
const confirmButton = document.getElementById('confirmButton');
const cancelButton = document.getElementById('cancelButton');

let fileText = '';

const OUTCOME_LABEL = {
  new: 'New volunteer, not yet invited',
  link: 'Has a ShelterLink login: linked to this shelter, keeps own details',
  duplicate: 'Skipped: already on this shelter',
  error: 'Skipped: needs fixing',
};

function setMessage(text, tone = '') {
  messageEl.replaceChildren();
  if (!text) return;
  const p = document.createElement('p');
  if (tone) p.className = tone;
  p.textContent = text;
  messageEl.appendChild(p);
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text == null || text === '' ? '-' : String(text);
  return td;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function renderSummary(summary) {
  summaryEl.replaceChildren();
  const lines = [
    [summary.new, plural(summary.new, 'new volunteer will be added', 'new volunteers will be added')],
    [summary.link, plural(summary.link, 'existing ShelterLink login will be linked', 'existing ShelterLink logins will be linked')],
    [summary.duplicate, plural(summary.duplicate, 'row is already on this shelter and will be skipped', 'rows are already on this shelter and will be skipped')],
    [summary.error, plural(summary.error, 'row has a problem and will be skipped', 'rows have problems and will be skipped')],
  ];
  for (const [count, text] of lines) {
    if (!count) continue;
    const li = document.createElement('li');
    li.textContent = text;
    summaryEl.appendChild(li);
  }
}

function renderRows(rows) {
  previewBody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = `import-row import-row-${row.outcome}`;
    const num = cell(row.row);
    num.className = 'numeric-cell';

    const who = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = `${row.first_name || ''} ${row.last_name || ''}`.trim() || '-';
    const email = document.createElement('div');
    email.className = 'muted';
    email.textContent = row.email || 'no email';
    who.append(name, email);

    const result = document.createElement('td');
    const label = document.createElement('span');
    label.className = `import-outcome import-outcome-${row.outcome}`;
    label.textContent = OUTCOME_LABEL[row.outcome] || row.outcome;
    result.appendChild(label);
    if (row.errors && row.errors.length) {
      const list = document.createElement('ul');
      list.className = 'import-errors';
      for (const error of row.errors) {
        const li = document.createElement('li');
        li.textContent = error;
        list.appendChild(li);
      }
      result.appendChild(list);
    }

    tr.append(num, who, cell(row.phone), cell(row.date_of_birth), result);
    previewBody.appendChild(tr);
  }
  previewCaption.textContent = `${plural(rows.length, 'row', 'rows')} in the file`;
}

async function postCsv(path) {
  const res = await apiRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: fileText,
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function preview(event) {
  event.preventDefault();
  setMessage('');
  previewSection.hidden = true;
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    setMessage('Choose a CSV file first.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    setMessage('The file is larger than 256 KB. Split it into smaller files.', 'error');
    return;
  }
  previewButton.disabled = true;
  try {
    fileText = await file.text();
    const { res, body } = await postCsv('/admin/volunteers/import/preview');
    if (!res.ok) {
      setMessage(body.error || 'The file could not be checked.', 'error');
      return;
    }
    renderSummary(body.summary);
    renderRows(body.rows);
    const ready = body.summary.new + body.summary.link;
    confirmButton.hidden = ready === 0;
    confirmButton.textContent = `Import ${plural(ready, 'volunteer', 'volunteers')}`;
    if (!ready) setMessage('Nothing in this file can be imported. Fix the rows marked below and check again.', 'error');
    previewSection.hidden = false;
  } catch (error) {
    setMessage(error.message || 'Network error checking the file.', 'error');
  } finally {
    previewButton.disabled = false;
  }
}

async function confirmImport() {
  confirmButton.disabled = true;
  try {
    const { res, body } = await postCsv('/admin/volunteers/import');
    if (!res.ok) {
      setMessage(body.error || 'The import did not run. Nothing was saved.', 'error');
      return;
    }
    previewSection.hidden = true;
    form.reset();
    fileText = '';
    const parts = [`Added ${plural(body.created, 'volunteer', 'volunteers')}`];
    if (body.linked) parts.push(`linked ${plural(body.linked, 'existing login', 'existing logins')}`);
    const skipped = (body.skipped_duplicates || 0) + (body.skipped_errors || 0);
    if (skipped) parts.push(`skipped ${plural(skipped, 'row', 'rows')}`);
    setMessage(`${parts.join(', ')}. New volunteers are listed as not yet invited in the volunteer directory.`, 'success');
  } catch (error) {
    setMessage(error.message || 'Network error. Nothing was saved.', 'error');
  } finally {
    confirmButton.disabled = false;
  }
}

function reset() {
  previewSection.hidden = true;
  form.reset();
  fileText = '';
  setMessage('');
  fileInput.focus();
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isAdminRole(user)) {
    window.location.href = '/pages/admin/volunteers.html';
    return;
  }
  applyRoleVisibility(user);
  form.addEventListener('submit', preview);
  confirmButton.addEventListener('click', confirmImport);
  cancelButton.addEventListener('click', reset);
}

document.addEventListener('DOMContentLoaded', init);
