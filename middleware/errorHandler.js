function resolveStatusCode(err) {
  if (!err) return 500;

  // Honor explicit HTTP status when provided.
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 600) {
    return err.status;
  }

  const type = String(err.type || '').toLowerCase();
  const name = String(err.name || '').toLowerCase();

  if (type.includes('validation') || name.includes('validation')) return 400;
  if (type.includes('auth') || name.includes('auth') || type.includes('unauthorized')) return 401;
  if (type.includes('permission') || type.includes('forbidden')) return 403;
  if (type.includes('not_found') || type.includes('not found') || name.includes('notfound')) return 404;

  return 500;
}

function defaultMessageForStatus(status) {
  switch (status) {
    case 400:
      return 'Invalid request data.';
    case 401:
      return 'Authentication required.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'Requested resource was not found.';
    default:
      return 'Internal server error.';
  }
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isProduction = process.env.NODE_ENV === 'production';
  const status = resolveStatusCode(err);

  if (isProduction) {
    const safeType = err?.type || err?.name || 'UnknownError';
    console.error(`[ErrorHandler] ${safeType} (${status})`);
  } else {
    console.error('[ErrorHandler] Full error:', err);
  }

  const message = err?.message || defaultMessageForStatus(status);
  return res.status(status).json({ error: message });
}

module.exports = { errorHandler };

