const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hidden || el.closest('[hidden]')) return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

export function trapTabKey(container, event) {
  if (event.key !== 'Tab') return;
  const list = getFocusableElements(container);
  if (!list.length) {
    event.preventDefault();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey) {
    if (document.activeElement === first || !container.contains(document.activeElement)) {
      event.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function bindFocusTrap(container) {
  const handler = (event) => trapTabKey(container, event);
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}
