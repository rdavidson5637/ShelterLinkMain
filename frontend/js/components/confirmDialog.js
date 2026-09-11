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
 * @param {string} [options.confirmClass='amber'] - for confirm (destructive) button
 * @param {string} [options.cancelClass='green'] - for cancel/keep button (default focus)
 * @param {Function} [options.onConfirm]
 * @param {Function} [options.onCancel]
 */
export function showConfirm(options = {}) {
  const {
    heading = 'Confirm',
    body = '',
    confirmText = 'Yes Cancel Application',
    cancelText = 'Keep Application',
    onConfirm,
    onCancel,
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
  cancelBtn.textContent = cancelText;
  confirmBtn.textContent = confirmText;

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

  const cleanup = () => {
    dialogEl.close();
    dialogEl.removeEventListener('keydown', handleKeydown);
    dialogEl.removeEventListener('click', backdropHandler);
    restoreFocus();
  };

  const backdropHandler = (e) => {
    if (e.target === dialogEl) {
      cleanup();
      if (onCancel) onCancel();
    }
  };

  const handleKeydown = (e) => {
    trapTabKey(dialogEl, e);
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      if (onCancel) onCancel();
    }
  };

  cancelBtn.onclick = () => {
    cleanup();
    if (onCancel) onCancel();
  };

  confirmBtn.onclick = () => {
    cleanup();
    if (onConfirm) onConfirm();
  };

  dialogEl.addEventListener('keydown', handleKeydown);
  dialogEl.addEventListener('click', backdropHandler);

  dialogEl.showModal();
  cancelBtn.focus();
}
