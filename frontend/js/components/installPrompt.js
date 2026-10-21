const DISMISS_KEY = 'sl-install-dismissed';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

let deferredPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    window.dispatchEvent(new CustomEvent('sl-install-available'));
  });
}

export function detectPlatform(userAgent, isStandalone, nav = globalThis.navigator) {
  if (isStandalone) return 'standalone';
  const ua = String(userAgent || '');
  const iPadOs = /Macintosh/.test(ua) && nav && nav.maxTouchPoints > 1;
  const ios = /iPad|iPhone|iPod/.test(ua) || iPadOs;
  if (ios) {
    if (/Instagram|FBAN|FBAV|LinkedInApp|CriOS|FxiOS/.test(ua)) return 'ios-inapp';
    return 'ios-safari';
  }
  if (/Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(ua) && !/OPR Mini/i.test(ua)) {
    return 'chromium';
  }
  return 'other';
}

export function isDismissed(now, storedValue) {
  const ts = Number(storedValue);
  if (!Number.isFinite(ts)) return false;
  return now - ts < DISMISS_MS;
}

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* treat as not dismissed */
  }
}

function shareIconSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path fill="currentColor" d="M16 5l-1.4 1.4 1.6 1.6H9v2h7.2l-1.6 1.6L16 13l4-4-4-4zM5 7v12h10v-2H7V9h2V7H5z"/>';
  return svg;
}

function card(children) {
  const article = document.createElement('article');
  article.className = 'install-card';
  article.setAttribute('role', 'region');
  article.setAttribute('aria-label', 'Install ShelterLink');
  children.forEach((node) => article.appendChild(node));
  return article;
}

function heading() {
  const h = document.createElement('h2');
  h.textContent = 'Put ShelterLink on your home screen';
  return h;
}

export function mountInstallPrompt(container) {
  if (!container) return;
  container.replaceChildren();

  const standalone =
    (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);
  const platform = detectPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
    standalone
  );

  if (platform === 'standalone' || platform === 'other') return;
  if (isDismissed(Date.now(), readDismissed())) return;

  function render() {
    container.replaceChildren();
    if (platform === 'chromium' && !deferredPrompt) return;

    const nodes = [heading()];
    if (platform === 'chromium') {
      const p = document.createElement('p');
      p.textContent = 'Open your shifts in one tap and get reminders on this phone.';
      nodes.push(p);
      const actions = document.createElement('p');
      const install = document.createElement('button');
      install.type = 'button';
      install.textContent = 'Install';
      install.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        container.replaceChildren();
      });
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'secondary';
      later.textContent = 'Not now';
      later.addEventListener('click', () => {
        writeDismissed();
        container.replaceChildren();
      });
      actions.append(install, later);
      nodes.push(actions);
    } else if (platform === 'ios-safari') {
      const p = document.createElement('p');
      p.append('1. Tap the Share button ');
      p.appendChild(shareIconSvg());
      p.append(' 2. Choose Add to Home Screen 3. Open ShelterLink from your home screen');
      const note = document.createElement('p');
      note.textContent =
        'Do this before turning on notifications. iPhones only allow them for apps on the home screen.';
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'secondary';
      later.textContent = 'Not now';
      later.addEventListener('click', () => {
        writeDismissed();
        container.replaceChildren();
      });
      nodes.push(p, note, later);
    } else if (platform === 'ios-inapp') {
      const p = document.createElement('p');
      p.textContent = 'Open this page in Safari to install ShelterLink.';
      nodes.push(p);
    }
    container.appendChild(card(nodes));
  }

  render();
  if (platform === 'chromium') {
    window.addEventListener('sl-install-available', render);
  }
  window.addEventListener('appinstalled', () => {
    container.replaceChildren();
  });
}
