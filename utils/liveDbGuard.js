'use strict';

function assertLiveWriteAllowed(databaseUrl, confirmFlag) {
  const url = String(databaseUrl || '');
  if (/supabase\.com/i.test(url) && confirmFlag !== 'yes') {
    const error = new Error(
      'Refusing to write a shelter to the live Supabase database. Set CONFIRM_LIVE_SHELTER=yes when you mean to.'
    );
    error.code = 'LIVE_DB_REFUSED';
    throw error;
  }
}

module.exports = { assertLiveWriteAllowed };
