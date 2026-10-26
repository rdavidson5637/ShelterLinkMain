/**
 * One stroke icon set for nav and status. 24px grid, 1.5px stroke,
 * currentColor. Decorative: callers always pair an icon with visible text
 * or an aria-label.
 */

const PATHS = {
  home: '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9v10h4.5v-5h3v5H18V9"/>',
  shifts: '<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  hours: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  messages: '<path d="M4.5 6.5h15v10h-9l-4 3v-3h-2z"/>',
  more: '<circle cx="6" cy="12" r="1.25"/><circle cx="12" cy="12" r="1.25"/><circle cx="18" cy="12" r="1.25"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  account: '<circle cx="12" cy="9" r="3.5"/><path d="M5 19.5c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5"/>',
};

export function icon(name, { size = 24 } = {}) {
  const body = PATHS[name] || '';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
