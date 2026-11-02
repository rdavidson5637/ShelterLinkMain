/**
 * Reusable accessible confirm dialog.
 * Replaces native confirm() with custom modal - clear labels, consistent UX.
 */
import { trapTabKey } from '../utils/focusTrap.js';

let dialogEl = null;
let previousActiveElement = null;

function createDialog() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
  dialog.setAttribute('aria-describedby', 'confirm-dialog-body');
  dialog.setAttribute('aria-modal', 'true');
  dialog.className = 'confirm-dialog';

  dialog.innerHTML = `
    <div class="confirm-dialog-card">
      <h2 id="confirm-dialog-title" class="confirm-dialog-title"></h2>
      <p id="confirm-dialog-body" class="confirm-dialog-body"></p>
      <div class="confirm-dialog-actions">
        <button type="button" id="confirmDialogCancel" class="confirm-dialog-btn confirm-dialog-btn-keep">Keep Application</button>
        <button type="button" id="confirmDialogExtra" class="confirm-dialog-btn confirm-dialog-btn-extra" hidden>Just this shift</button>
        <button type="button" id="confirmDialogConfirm" class="confirm-dialog-btn confirm-dialog-btn-cancel">Yes Cancel Application</button>
      </div>
    </div>
  `;

  return dialog;
}

/**
 * @param {Object} options
 * @param {string} options.heading
 * @param {string} options.body
 * @param {string} [options.confirmText='Yes Cancel Application']
 * @param {string} [options.cancelText='Keep Application']
 * @param {string} [options.extraText] - third choice; hidden when omitted
 * @param {string} [options.confirmClass='amber'] - for confirm (destructive) button
 * @param {string} [options.cancelClass='green'] - for cancel/keep button (default focus)
 * @param {Function} [options.onConfirm]
 * @param {Function} [options.onCancel]
 * @param {Function} [options.onExtra]
 * @returns {Promise<'keep'|'confirm'|'extra'>}
 */
export function showConfirm(options = {}) {
  const {
    heading = 'Confirm',
    body = '',
    confirmText = 'Yes Cancel Application',
    cancelText = 'Keep Application',
    extraText = '',
    onConfirm,
    onCancel,
    onExtra,
  } = options;

  if (!dialogEl) {
    dialogEl = createDialog();
    document.body.appendChild(dialogEl);
  }

  previousActiveElement = document.activeElement;
  dialogEl.querySelector('.confirm-dialog-title').textContent = heading;
  dialogEl.querySelector('#confirm-dialog-body').textContent = body;
  const cancelBtn = dialogEl.querySelector('#confirmDialogCancel');
  const confirmBtn = dialogEl.querySelector('#confirmDialogConfirm');
  const extraBtn = dialogEl.querySelector('#confirmDialogExtra');
  cancelBtn.textContent = cancelText;
  confirmBtn.textContent = confirmText;
  if (extraText) {
    extraBtn.hidden = false;
    extraBtn.textContent = extraText;
  } else {
    extraBtn.hidden = true;
    extraBtn.textContent = '';
  }

  const restoreFocus = () => {
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      try {
        previousActiveElement.focus();
      } catch (_) {
        /* ignore */
      }
    }
    previousActiveElement = null;
  };

  let settled = false;
  let settle = () => {};

  const cleanup = () => {
    dialogEl.close();
    dialogEl.removeEventListener('keydown', handleKeydown);
    dialogEl.removeEventListener('click', backdropHandler);
    restoreFocus();
  };

  const finish = (result, callback) => {
    if (settled) return;
    settled = true;
    cleanup();
    settle(result);
    if (callback) callback();
  };

  const backdropHandler = (e) => {
    if (e.target === dialogEl) finish('keep', onCancel);
  };

  const handleKeydown = (e) => {
    trapTabKey(dialogEl, e);
    if (e.key === 'Escape') {
      e.preventDefault();
      finish('keep', onCancel);
    }
  };

  return new Promise((resolve) => {
    settle = resolve;

    cancelBtn.onclick = () => finish('keep', onCancel);
    confirmBtn.onclick = () => finish('confirm', onConfirm);
    extraBtn.onclick = () => {
      if (!extraText) return;
      finish('extra', onExtra);
    };

    dialogEl.addEventListener('keydown', handleKeydown);
    dialogEl.addEventListener('click', backdropHandler);

    dialogEl.showModal();
    cancelBtn.focus();
  });
}
