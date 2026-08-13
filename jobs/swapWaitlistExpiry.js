'use strict';

const SwapRequest = require('../models/SwapRequest');

/**
 * Promote waitlist-exclusive open swaps to public after the 12h offer window.
 */
async function runSwapWaitlistExpiry(now = new Date()) {
  const published = await SwapRequest.publishExpiredWaitlistOffers(now);
  return { published };
}

module.exports = {
  runSwapWaitlistExpiry,
};
