import { icon } from './icons.js';

const nav = document.querySelector('.site-nav');
const toggle = nav?.querySelector('.nav-toggle');
if (nav && toggle) {
  toggle.removeAttribute('aria-label');
  toggle.innerHTML = `${icon('menu', { size: 20 })}<span>Menu</span>`;

  const setOpen = (open) => {
    nav.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('nav-open')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('nav-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
}
