'use strict';

const MessageThread = require('../models/MessageThread');
const { isStaffOrAdmin } = require('../middleware/auth');
const { hasContactLeak } = require('../utils/contactPrivacy');

function ensureAuth(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function isStaff(req) {
  return isStaffOrAdmin(req);
}

function assertNoContactLeak(payload, res) {
  if (hasContactLeak(payload)) {
    console.error('[Threads] contact field leaked in volunteer response');
    res.status(500).json({ error: 'Internal server error' });
    return false;
  }
  return true;
}

async function assertCanAccessThread(req, thread) {
  if (!thread) return { ok: false, status: 404, error: 'Thread not found' };
  if (isStaff(req)) return { ok: true };
  const member = await MessageThread.isParticipant(thread.id, req.session.userId);
  if (!member) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true };
}

/**
 * GET /api/threads
 */
async function listThreads(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const staff = isStaff(req);
    const threads = await MessageThread.listForUser(req.session.userId, { isStaff: staff });
    if (!staff && !assertNoContactLeak(threads, res)) return;
    return res.status(200).json(threads);
  } catch (error) {
    console.error('[Threads] listThreads error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/threads/unread-count
 */
async function getUnreadCount(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const count = await MessageThread.unreadCountForUser(req.session.userId, {
      isStaff: isStaff(req),
    });
    return res.status(200).json({ count });
  } catch (error) {
    console.error('[Threads] getUnreadCount error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/threads/:id
 */
async function getThread(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId < 1) {
      return res.status(400).json({ error: 'Invalid thread id' });
    }

    const thread = await MessageThread.getById(threadId);
    const access = await assertCanAccessThread(req, thread);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const staff = isStaff(req);
    if (staff) {
      await MessageThread.ensureParticipant(threadId, req.session.userId);
    }

    const detail = await MessageThread.getThreadDetail(threadId, {
      forVolunteer: !staff,
    });
    if (!staff && !assertNoContactLeak(detail, res)) return;

    // Mark read on open
    try {
      await MessageThread.markRead(threadId, req.session.userId);
    } catch (readError) {
      console.error('[Threads] markRead on open failed:', readError.message);
    }

    return res.status(200).json(detail);
  } catch (error) {
    console.error('[Threads] getThread error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/threads
 * Staff: announcement or opportunity thread.
 * Volunteer: opportunity thread only (must be accepted/approved on that shift).
 */
async function createThread(req, res) {
  try {
    if (!ensureAuth(req, res)) return;

    const staff = isStaff(req);
    const body = req.body || {};
    let contextType = String(body.context_type || body.contextType || '').trim();
    const contextIdRaw = body.context_id != null ? body.context_id : body.contextId;
    const subject = body.subject != null ? String(body.subject).trim() : null;
    const initialBody =
      body.body != null ? String(body.body).trim() : body.message != null ? String(body.message).trim() : '';

    if (!contextType && body.opportunity_id != null) {
      contextType = 'opportunity';
    }
    const contextId =
      contextIdRaw != null
        ? Number(contextIdRaw)
        : body.opportunity_id != null
          ? Number(body.opportunity_id)
          : null;

    if (!MessageThread.CONTEXT_TYPES.has(contextType)) {
      return res.status(400).json({
        error:
          'context_type must be one of opportunity, foster_placement, transport_run, direct, announcement',
      });
    }

    if (contextType === 'announcement') {
      if (!staff) {
        return res.status(403).json({ error: 'Only staff can create announcements' });
      }
    } else if (contextType === 'opportunity') {
      if (!Number.isFinite(contextId) || contextId < 1) {
        return res.status(400).json({ error: 'context_id (opportunity id) is required' });
      }
      if (!staff) {
        const participants = await MessageThread.resolveParticipantsForOpportunity(contextId);
        if (!participants.includes(Number(req.session.userId))) {
          return res.status(403).json({
            error: 'You must be accepted on this shift to open its chat',
          });
        }
      }
    } else if (!staff) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const thread = await MessageThread.createOrGetForContext({
      contextType,
      contextId: contextType === 'announcement' ? null : contextId,
      createdBy: req.session.userId,
      subject:
        subject ||
        (contextType === 'announcement'
          ? 'Announcement'
          : contextType === 'opportunity'
            ? `Shift chat #${contextId}`
            : null),
    });

    let message = null;
    if (initialBody) {
      if (contextType === 'announcement' && !staff) {
        return res.status(403).json({ error: 'Only staff can post in announcements' });
      }
      message = await MessageThread.addMessage(thread.id, req.session.userId, initialBody);
    }

    const detail = await MessageThread.getThreadDetail(thread.id, {
      forVolunteer: !staff,
    });
    if (!staff && !assertNoContactLeak(detail, res)) return;

    return res.status(201).json({
      ...detail,
      initial_message: message,
    });
  } catch (error) {
    console.error('[Threads] createThread error:', error.message);
    const status = error.status || 500;
    return res.status(status).json({
      error: status === 400 ? error.message : 'Internal server error',
    });
  }
}

/**
 * POST /api/threads/:id/messages
 */
async function postMessage(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId < 1) {
      return res.status(400).json({ error: 'Invalid thread id' });
    }

    const thread = await MessageThread.getById(threadId);
    const access = await assertCanAccessThread(req, thread);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const staff = isStaff(req);
    if (thread.context_type === 'announcement' && !staff) {
      return res.status(403).json({ error: 'Only staff can post in announcements' });
    }

    if (thread.closed_at) {
      return res.status(400).json({ error: 'This thread is closed' });
    }

    if (!staff) {
      const member = await MessageThread.isParticipant(threadId, req.session.userId);
      if (!member) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else {
      await MessageThread.ensureParticipant(threadId, req.session.userId);
    }

    const body = req.body?.body != null ? req.body.body : req.body?.message;
    const message = await MessageThread.addMessage(threadId, req.session.userId, body);
    const safe = staff
      ? message
      : MessageThread.toSafeMessage(
          {
            ...message,
            first_name: message.first_name,
            last_name: message.last_name,
            role: message.role,
          },
          { forVolunteer: true }
        );

    if (!staff && !assertNoContactLeak(safe, res)) return;
    return res.status(201).json(safe);
  } catch (error) {
    console.error('[Threads] postMessage error:', error.message);
    const status = error.status || 500;
    return res.status(status).json({
      error: status === 400 || status === 403 ? error.message : 'Internal server error',
    });
  }
}

/**
 * DELETE /api/threads/:id/messages/:messageId
 */
async function deleteMessage(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const threadId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(threadId) || threadId < 1 || !Number.isFinite(messageId) || messageId < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const thread = await MessageThread.getById(threadId);
    const access = await assertCanAccessThread(req, thread);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const message = await MessageThread.findMessageById(messageId);
    if (!message || Number(message.thread_id) !== threadId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const updated = await MessageThread.softDeleteMessage(messageId, req.session.userId, {
      isStaff: isStaff(req),
    });
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[Threads] deleteMessage error:', error.message);
    const status = error.status || 500;
    return res.status(status).json({
      error: status === 403 || status === 404 ? error.message : 'Internal server error',
    });
  }
}

/**
 * POST /api/threads/:id/read
 */
async function markThreadRead(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId < 1) {
      return res.status(400).json({ error: 'Invalid thread id' });
    }
    const thread = await MessageThread.getById(threadId);
    const access = await assertCanAccessThread(req, thread);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    await MessageThread.markRead(threadId, req.session.userId);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[Threads] markThreadRead error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/threads/:id/mute
 * Body: { muted: true|false } — defaults to toggle on when muted omitted.
 */
async function muteThread(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId < 1) {
      return res.status(400).json({ error: 'Invalid thread id' });
    }
    const thread = await MessageThread.getById(threadId);
    const access = await assertCanAccessThread(req, thread);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    let muted;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'muted')) {
      muted = Boolean(req.body.muted);
    } else {
      const participants = await MessageThread.getParticipants(threadId);
      const me = participants.find((p) => Number(p.user_id) === Number(req.session.userId));
      muted = !(me && Number(me.muted));
    }

    const result = await MessageThread.setMuted(threadId, req.session.userId, muted);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Threads] muteThread error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listThreads,
  getUnreadCount,
  getThread,
  createThread,
  postMessage,
  deleteMessage,
  markThreadRead,
  muteThread,
};
