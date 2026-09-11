import { requireAuth, logout } from '../auth.js';
import { createThreadsController, setStatus } from '../components/threadsUi.js';

const statusEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (user.role !== 'volunteer') {
    window.location.href = '/pages/admin/threads.html';
    return;
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', () => logout());
  }

  const controller = createThreadsController({
    isAdmin: false,
    statusEl,
    threadsListEl: document.getElementById('threadsList'),
    threadEmptyEl: document.getElementById('threadEmpty'),
    threadViewEl: document.getElementById('threadView'),
    threadSubjectEl: document.getElementById('threadSubject'),
    threadMetaEl: document.getElementById('threadMeta'),
    participantsEl: document.getElementById('participants'),
    messagesListEl: document.getElementById('messagesList'),
    composeForm: document.getElementById('composeForm'),
    composeBody: document.getElementById('composeBody'),
    muteButton: document.getElementById('muteButton'),
    currentUserId: user.user_id || user.userId || user.id,
  });

  try {
    await controller.init();
  } catch (error) {
    console.error('[Volunteer] messages init error:', error);
    setStatus(statusEl, 'Could not load messages', 'error');
  }
}

init();
