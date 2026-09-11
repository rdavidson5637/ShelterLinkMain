import { requireAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { createThreadsController, setStatus } from '../components/threadsUi.js';

const statusEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/messages.html';
    return;
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', () => logout());
  }

  const controller = createThreadsController({
    isAdmin: true,
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
    announcementForm: document.getElementById('announcementForm'),
    currentUserId: user.user_id || user.userId || user.id,
  });

  try {
    await controller.init();
  } catch (error) {
    console.error('[Admin] threads init error:', error);
    setStatus(statusEl, 'Could not load threads', 'error');
  }
}

init();
