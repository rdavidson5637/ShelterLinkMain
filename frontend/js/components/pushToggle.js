import { apiRequest } from '../config.js';
import { getRegistration } from '../pwa.js';

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isIos() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true
  );
}

function setContent(container, nodes) {
  container.replaceChildren();
  nodes.forEach((node) => container.appendChild(node));
}

function para(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

async function currentSubscription() {
  const reg = await getRegistration();
  if (!reg || !reg.pushManager) return null;
  return reg.pushManager.getSubscription();
}

export async function mountPushToggle(container) {
  if (!container) return;

  async function render() {
    container.replaceChildren();
    let prefs = { configured: false };
    try {
      const res = await apiRequest('/push/prefs', { method: 'GET' });
      if (res.ok) prefs = await res.json();
    } catch {
      prefs = { configured: false };
    }
    if (!prefs.configured) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      setContent(container, [para("This browser can't show ShelterLink notifications.")]);
      return;
    }

    if (isIos() && !isStandalone()) {
      setContent(container, [
        para('To get notifications on iPhone, add ShelterLink to your home screen first, then open it from there.'),
      ]);
      return;
    }

    if (Notification.permission === 'denied') {
      setContent(container, [
        para("Notifications are blocked for ShelterLink. Turn them on in your phone's settings."),
      ]);
      return;
    }

    const subscription = await currentSubscription();
    if (!subscription) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Turn on notifications for this phone';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            await render();
            return;
          }
          const keyRes = await apiRequest('/push/vapid-public-key', { method: 'GET' });
          const keyBody = await keyRes.json().catch(() => ({}));
          if (!keyRes.ok || !keyBody.publicKey) {
            setContent(container, [para(keyBody.error || 'Push is not available.')]);
            return;
          }
          const reg = await getRegistration();
          if (!reg) {
            setContent(container, [para('Could not start the app service. Reload the page and try again.')]);
            return;
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
          });
          await apiRequest('/push/subscribe', {
            method: 'POST',
            body: { subscription: sub.toJSON() },
          });
        } catch (error) {
          console.warn('[Push] subscribe failed:', error);
        }
        await render();
      });
      setContent(container, [button]);
      return;
    }

    const on = para('Notifications are on for this phone.');
    const test = document.createElement('button');
    test.type = 'button';
    test.textContent = 'Send a test';
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        const res = await apiRequest('/push/test', { method: 'POST', body: {} });
        const body = await res.json().catch(() => ({}));
        const note = para(
          res.ok ? 'Test sent. Check this phone.' : body.error || 'Could not send a test.'
        );
        container.appendChild(note);
      } catch {
        container.appendChild(para("You're offline. Try again when you have signal."));
      }
      test.disabled = false;
    });
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'secondary';
    off.textContent = 'Turn off';
    off.addEventListener('click', async () => {
      try {
        await apiRequest('/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      } catch (error) {
        console.warn('[Push] unsubscribe failed:', error);
      }
      await render();
    });
    const actions = document.createElement('p');
    actions.append(test, off);
    setContent(container, [on, actions]);
  }

  await render();
}
