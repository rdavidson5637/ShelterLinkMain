'use strict';

/**
 * Newsletter audience sync provider interface.
 *
 * ShelterLink can export opted-in volunteers as CSV. Syncing that audience to
 * Brevo or Mailchimp is not switched on: there is no provider account, no API
 * key, and no env flag that turns sync on. This file only fixes the shape a
 * provider must have so Brevo or Mailchimp can be added later without touching
 * the export path.
 *
 * A provider is an object with:
 *   name: string
 *   isEnabled(): boolean
 *   syncAudience({ contacts, shelterId }): Promise<{
 *     synced: boolean,
 *     skipped?: boolean,
 *     reason?: string,
 *     count?: number
 *   }>
 *
 * getNewsletterSyncProvider() always returns the disabled provider. Setting
 * NEWSLETTER_SYNC_PROVIDER, BREVO_*, or MAILCHIMP_* does not enable sync.
 */

const REQUIRED_METHODS = ['isEnabled', 'syncAudience'];

const disabledNewsletterSyncProvider = Object.freeze({
  name: 'disabled',
  isEnabled() {
    return false;
  },
  async syncAudience() {
    return { synced: false, skipped: true, reason: 'newsletter_sync_disabled', count: 0 };
  },
});

/** Names reserved for future real providers. None are registered yet. */
const FUTURE_PROVIDER_NAMES = Object.freeze(['brevo', 'mailchimp']);

function isNewsletterSyncProvider(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  if (typeof candidate.name !== 'string' || !candidate.name) return false;
  return REQUIRED_METHODS.every((method) => typeof candidate[method] === 'function');
}

function getNewsletterSyncProvider() {
  return disabledNewsletterSyncProvider;
}

module.exports = {
  REQUIRED_METHODS,
  FUTURE_PROVIDER_NAMES,
  disabledNewsletterSyncProvider,
  isNewsletterSyncProvider,
  getNewsletterSyncProvider,
};
