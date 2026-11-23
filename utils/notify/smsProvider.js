'use strict';

/**
 * SMS provider interface. SMS is switched off for ShelterLink.
 *
 * SMS has not been agreed with any charity, and there is no SMS provider
 * account and no budget for SMS. This file only fixes the shape a provider
 * must have, so SMS can be added later without touching the notification
 * code. The only provider here is the disabled one, and getSmsProvider()
 * always returns it. Setting an environment variable does not turn SMS on.
 *
 * A provider is an object with:
 *   name: string
 *   isEnabled(): boolean
 *   send({ to, body, kind }): Promise<{ sent: boolean, skipped?: boolean, reason?: string }>
 *
 * Turning SMS on later means: write a provider that fits this shape, add it
 * here, and add per-volunteer opt-in and phone verification. That needs
 * Ryan's sign-off and the charity's agreement first.
 */

const REQUIRED_METHODS = ['isEnabled', 'send'];

const disabledSmsProvider = Object.freeze({
  name: 'disabled',
  isEnabled() {
    return false;
  },
  async send() {
    return { sent: false, skipped: true, reason: 'sms_disabled' };
  },
});

function isSmsProvider(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  if (typeof candidate.name !== 'string' || !candidate.name) return false;
  return REQUIRED_METHODS.every((method) => typeof candidate[method] === 'function');
}

function getSmsProvider() {
  return disabledSmsProvider;
}

module.exports = {
  REQUIRED_METHODS,
  disabledSmsProvider,
  isSmsProvider,
  getSmsProvider,
};
