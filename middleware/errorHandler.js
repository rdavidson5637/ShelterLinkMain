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

function clientMessage(err, status, isProduction) {
  const fallback = defaultMessageForStatus(status);
  const message = String(err?.message || fallback);
  if (!isProduction) return message;
  if (status >= 500) return fallback;
  if (/(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|syntax error|\/Users\/|node_modules)/i.test(message)) {
    return fallback;
  }
  return message;
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isProduction = process.env.NODE_ENV === 'production';
  const status = resolveStatusCode(err);
  const requestId = req && req.id ? req.id : null;
  const logged = String(err?.message || err?.type || 'error').replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    '[email]'
  );

  if (isProduction) {
    console.error(`[ErrorHandler] ${status} ${requestId || '-'} ${logged}`);
  } else {
    console.error(`[ErrorHandler] ${status} ${requestId || '-'}`, err);
  }

  return res.status(status).json({
    error: clientMessage(err, status, isProduction),
    requestId,
  });
}

module.exports = { errorHandler };

