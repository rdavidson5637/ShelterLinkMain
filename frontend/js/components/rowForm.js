/**
 * A small form that takes over a ruled row's end (the action area): used for
 * "add a note", "log a check-in" and similar one-step actions. Cancel puts
 * the original actions back. Styles: .row-form in custom.css.
 */

/** Swap a row's end for a small form; Cancel puts the row back. */
export function openRowForm(row, buildFields, submitLabel, onSubmit) {
  const end = row.querySelector('.ruled-row-end');
  const saved = [...end.childNodes];
  const form = document.createElement('form');
  form.className = 'row-form';
  const fields = buildFields();
  const buttons = document.createElement('span');
  buttons.className = 'actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = submitLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => end.replaceChildren(...saved));
  buttons.append(submit, cancel);
  form.append(...fields, buttons);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await onSubmit(form);
    } finally {
      submit.disabled = false;
    }
  });
  end.replaceChildren(form);
  form.querySelector('input, select, textarea')?.focus();
}

export function textField(label, className, placeholder = '') {
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.maxLength = 500;
  input.placeholder = placeholder;
  lab.appendChild(input);
  return lab;
}
