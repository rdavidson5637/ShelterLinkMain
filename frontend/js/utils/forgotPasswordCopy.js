export const GENERIC_RESET_NOTICE =
  'If that email is registered, a reset link has been sent. Check your inbox (and spam folder).';

const LOGIN_FLAVOURED = /invalid credentials|unauthorized|user not found/i;

export function forgotPasswordFeedback(res, data = {}) {
  const status = Number(res?.status) || 0;
  const raw = String(data.error || data.message || '');

  if (status === 429) {
    return {
      type: 'error',
      text: raw || 'Too many password reset requests. Please try again later.',
      hideForm: false,
    };
  }

  if (res?.ok || status === 401 || status === 404 || LOGIN_FLAVOURED.test(raw)) {
    return { type: 'success', text: GENERIC_RESET_NOTICE, hideForm: true };
  }

  if (status === 400 && /email is required/i.test(raw)) {
    return { type: 'error', text: 'Enter your email address.', hideForm: false };
  }

  return {
    type: 'error',
    text: 'Unable to send a reset link right now. Please try again.',
    hideForm: false,
  };
}
