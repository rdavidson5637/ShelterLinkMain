/**
 * Shared threaded messaging UI helpers for volunteer + admin pages.
 */

import { apiRequest } from '../config.js';

export function setStatus(el, text, tone = 'neutral') {
  if (!el) return;
  if (!text) {
    el.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  el.innerHTML = `<p class="${cls}">${escapeHtml(text)}</p>`;
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export function contextLabel(thread) {
  const type = thread?.context_type || '';
  if (type === 'opportunity') return `Shift #${thread.context_id || '?'}`;
  if (type === 'announcement') return 'Announcement';
  if (type === 'foster_placement') return `Foster #${thread.context_id || '?'}`;
  if (type === 'transport_run') return `Transport #${thread.context_id || '?'}`;
  if (type === 'direct') return 'Direct';
  return type || 'Thread';
}

export async function openShiftChat(opportunityId, { subject } = {}) {
  const id = Number(opportunityId);
  if (!Number.isFinite(id) || id < 1) {
    throw new Error('Invalid opportunity id');
  }
  const res = await apiRequest('/threads', {
    method: 'POST',
    body: {
      context_type: 'opportunity',
      context_id: id,
      subject: subject || `Shift chat #${id}`,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not open shift chat');
  }
  const thread = await res.json();
  return thread;
}

export function messagesPageHref(threadId, { admin = false } = {}) {
  const base = admin ? '/pages/admin/threads.html' : '/pages/volunteer/messages.html';
  return threadId ? `${base}?thread=${encodeURIComponent(threadId)}` : base;
}

export function createThreadsController({
  isAdmin = false,
  statusEl,
  threadsListEl,
  threadEmptyEl,
  threadViewEl,
  threadSubjectEl,
  threadMetaEl,
  participantsEl,
  messagesListEl,
  composeForm,
  composeBody,
  muteButton,
  announcementForm = null,
  currentUserId = null,
}) {
  let threads = [];
  let selectedId = null;
  let detail = null;
  let muted = false;

  function renderThreadList() {
    if (!threadsListEl) return;
    threadsListEl.innerHTML = '';
    if (!threads.length) {
      threadsListEl.innerHTML = `<div class="empty-state">
        <p>No threads yet.</p>
        <a href="#announcementForm" role="button" class="outline">Post an announcement</a>
      </div>`;
      return;
    }
    threads.forEach((thread) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `thread-list-item${Number(thread.id) === Number(selectedId) ? ' is-active' : ''}`;
      const unread = Number(thread.unread_count) || 0;
      btn.innerHTML = `
        <span class="thread-list-title">${escapeHtml(thread.subject || contextLabel(thread))}</span>
        <span class="thread-list-meta">${escapeHtml(contextLabel(thread))}${
          unread ? ` · <strong>${unread} new</strong>` : ''
        }</span>
      `;
      btn.addEventListener('click', () => selectThread(thread.id));
      threadsListEl.appendChild(btn);
    });
  }

  function renderParticipants() {
    if (!participantsEl) return;
    const list = detail?.participants || [];
    if (!list.length) {
      participantsEl.innerHTML = '';
      return;
    }
    participantsEl.innerHTML = `<strong>Participants:</strong> ${list
      .map((p) => escapeHtml(p.display_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()))
      .join(', ')}`;
  }

  function canDeleteMessage(msg) {
    if (!msg || msg.deleted_at) return false;
    if (isAdmin) return true;
    if (Number(msg.user_id) !== Number(currentUserId)) return false;
    const created = new Date(msg.created_at).getTime();
    return Number.isFinite(created) && Date.now() - created <= 15 * 60 * 1000;
  }

  function renderMessages() {
    if (!messagesListEl) return;
    messagesListEl.innerHTML = '';
    const list = detail?.messages || [];
    if (!list.length) {
      messagesListEl.innerHTML = '<p class="threads-empty-inline">No messages yet.</p>';
      return;
    }
    list.forEach((msg) => {
      const row = document.createElement('article');
      row.className = `message-bubble${msg.deleted_at ? ' is-deleted' : ''}`;
      const who = escapeHtml(msg.display_name || 'Someone');
      const when = escapeHtml(formatWhen(msg.created_at));
      const body = escapeHtml(msg.body || '');
      row.innerHTML = `
        <header><strong>${who}</strong> <time>${when}</time></header>
        <p>${body}</p>
      `;
      if (canDeleteMessage(msg)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'secondary message-delete';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          try {
            const res = await apiRequest(`/threads/${selectedId}/messages/${msg.id}`, {
              method: 'DELETE',
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              setStatus(statusEl, err.error || 'Could not delete', 'error');
              return;
            }
            await selectThread(selectedId);
          } catch {
            setStatus(statusEl, 'Could not delete message', 'error');
          }
        });
        row.appendChild(del);
      }
      messagesListEl.appendChild(row);
    });
    messagesListEl.scrollTop = messagesListEl.scrollHeight;
  }

  function showDetail() {
    if (threadEmptyEl) threadEmptyEl.hidden = true;
    if (threadViewEl) threadViewEl.hidden = false;
    if (threadSubjectEl) {
      threadSubjectEl.textContent = detail?.subject || contextLabel(detail);
    }
    if (threadMetaEl) {
      threadMetaEl.textContent = `${contextLabel(detail)} · ${formatWhen(detail?.created_at)}`;
    }
    muted = Boolean(Number(detail?.muted));
    if (muteButton) {
      muteButton.textContent = muted ? 'Unmute' : 'Mute';
    }
    // Refresh muted from participant list if present
    const me = (detail?.participants || []).find(
      (p) => Number(p.user_id) === Number(currentUserId)
    );
    if (me) {
      muted = Boolean(Number(me.muted));
      if (muteButton) muteButton.textContent = muted ? 'Unmute' : 'Mute';
    }
    renderParticipants();
    renderMessages();
  }

  function hideDetail() {
    if (threadEmptyEl) threadEmptyEl.hidden = false;
    if (threadViewEl) threadViewEl.hidden = true;
    detail = null;
    selectedId = null;
  }

  async function loadThreads() {
    const res = await apiRequest('/threads', { method: 'GET' });
    if (!res.ok) {
      setStatus(statusEl, 'Failed to load threads', 'error');
      return;
    }
    threads = await res.json();
    if (!Array.isArray(threads)) threads = [];
    renderThreadList();
  }

  async function selectThread(id) {
    selectedId = Number(id);
    const res = await apiRequest(`/threads/${selectedId}`, { method: 'GET' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(statusEl, err.error || 'Failed to open thread', 'error');
      return;
    }
    detail = await res.json();
    // Keep list unread in sync
    threads = threads.map((t) =>
      Number(t.id) === selectedId ? { ...t, unread_count: 0 } : t
    );
    renderThreadList();
    showDetail();
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!selectedId || !composeBody) return;
    const body = composeBody.value.trim();
    if (!body) return;
    const res = await apiRequest(`/threads/${selectedId}/messages`, {
      method: 'POST',
      body: { body },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(statusEl, err.error || 'Failed to send', 'error');
      return;
    }
    composeBody.value = '';
    setStatus(statusEl, '');
    await selectThread(selectedId);
    await loadThreads();
  }

  async function toggleMute() {
    if (!selectedId) return;
    const res = await apiRequest(`/threads/${selectedId}/mute`, {
      method: 'POST',
      body: { muted: !muted },
    });
    if (!res.ok) {
      setStatus(statusEl, 'Could not update mute', 'error');
      return;
    }
    const data = await res.json();
    muted = Boolean(Number(data.muted));
    if (muteButton) muteButton.textContent = muted ? 'Unmute' : 'Mute';
  }

  if (composeForm) {
    composeForm.addEventListener('submit', (event) => {
      sendMessage(event).catch(() => setStatus(statusEl, 'Failed to send', 'error'));
    });
  }
  if (muteButton) {
    muteButton.addEventListener('click', () => {
      toggleMute().catch(() => setStatus(statusEl, 'Could not update mute', 'error'));
    });
  }
  if (announcementForm) {
    announcementForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const subject = document.getElementById('announcementSubject')?.value?.trim();
      const body = document.getElementById('announcementBody')?.value?.trim();
      if (!subject || !body) return;
      const res = await apiRequest('/threads', {
        method: 'POST',
        body: { context_type: 'announcement', subject, body },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStatus(statusEl, err.error || 'Could not create announcement', 'error');
        return;
      }
      const created = await res.json();
      announcementForm.reset();
      setStatus(statusEl, 'Announcement posted', 'success');
      await loadThreads();
      if (created?.id) await selectThread(created.id);
    });
  }

  return {
    async init(preferredThreadId = null) {
      await loadThreads();
      const fromQuery = preferredThreadId || new URLSearchParams(window.location.search).get('thread');
      if (fromQuery) {
        await selectThread(fromQuery);
      } else {
        hideDetail();
      }
    },
    loadThreads,
    selectThread,
  };
}
