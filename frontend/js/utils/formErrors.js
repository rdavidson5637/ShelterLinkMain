/**
 * Per-field errors plus a focusable error summary for failed form submits.
 */

function fieldElement(form, field) {
  if (!field) return null;
  if (typeof field !== 'string') return field;
  return (
    form.querySelector(`#${CSS.escape(field)}`) ||
    form.querySelector(`[name="${CSS.escape(field)}"]`)
  );
}

export function ensureErrorSummary(form) {
  if (!form) return null;
  let summary = form.querySelector('.form-error-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'form-error-summary';
    summary.setAttribute('role', 'alert');
    summary.setAttribute('tabindex', '-1');
    summary.hidden = true;
    form.prepend(summary);
  }
  return summary;
}

export function clearFormErrors(form) {
  if (!form) return;
  const summary = form.querySelector('.form-error-summary');
  if (summary) {
    summary.hidden = true;
    summary.innerHTML = '';
  }
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    el.removeAttribute('aria-invalid');
    const kept = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && !/-error-\d+$/.test(id));
    if (kept.length) el.setAttribute('aria-describedby', kept.join(' '));
    else el.removeAttribute('aria-describedby');
  });
  form.querySelectorAll('.field-error').forEach((el) => el.remove());
}

export function showFormErrors(form, errors = []) {
  if (!form) return;
  clearFormErrors(form);
  const list = (errors || []).filter((item) => item && item.message);
  if (!list.length) return;

  const summary = ensureErrorSummary(form);
  const heading = document.createElement('p');
  heading.className = 'form-error-summary-heading';
  heading.textContent =
    list.length === 1 ? 'There is 1 error in this form.' : `There are ${list.length} errors in this form.`;
  const ul = document.createElement('ul');

  list.forEach((item, index) => {
    const el = fieldElement(form, item.field);
    const errorId = `${el?.id || 'field'}-error-${index}`;
    if (el) {
      el.setAttribute('aria-invalid', 'true');
      const hint = document.createElement('p');
      hint.className = 'field-error';
      hint.id = errorId;
      hint.textContent = item.message;
      el.insertAdjacentElement('afterend', hint);
      const describedBy = [el.getAttribute('aria-describedby'), errorId].filter(Boolean).join(' ');
      el.setAttribute('aria-describedby', describedBy);
    }
    const li = document.createElement('li');
    if (el?.id) {
      const a = document.createElement('a');
      a.href = `#${el.id}`;
      a.textContent = item.message;
      a.addEventListener('click', (event) => {
        event.preventDefault();
        el.focus();
      });
      li.appendChild(a);
    } else {
      li.textContent = item.message;
    }
    ul.appendChild(li);
  });

  summary.append(heading, ul);
  summary.hidden = false;
  summary.focus();
}
