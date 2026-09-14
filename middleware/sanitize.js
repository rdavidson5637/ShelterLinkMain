const validator = require('validator');
const xss = require('xss');

const SKIP_SANITIZE_KEYS = new Set([
  'password',
  'confirm_password',
  'current_password',
  'new_password',
  'admin_key',
  'token',
]);

function sanitizeValue(value, key, invalidEmails, pathLabel) {
  if (typeof value === 'string') {
    if (SKIP_SANITIZE_KEYS.has(String(key || '').toLowerCase())) {
      return value;
    }
    const cleaned = xss(value.trim());
    if (key && key.toLowerCase() === 'email' && cleaned && !validator.isEmail(cleaned)) {
      invalidEmails.push(pathLabel || key);
    }
    return cleaned;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, key, invalidEmails, `${pathLabel}[${index}]`));
  }

  if (value && typeof value === 'object') {
    const output = {};
    Object.entries(value).forEach(([nestedKey, nestedValue]) => {
      const nestedPath = pathLabel ? `${pathLabel}.${nestedKey}` : nestedKey;
      output[nestedKey] = sanitizeValue(nestedValue, nestedKey, invalidEmails, nestedPath);
    });
    return output;
  }

  return value;
}

function sanitizeContainer(container, invalidEmails) {
  if (!container || typeof container !== 'object') return container;

  const sanitized = {};
  Object.entries(container).forEach(([key, value]) => {
    sanitized[key] = sanitizeValue(value, key, invalidEmails, key);
  });
  return sanitized;
}

function sanitizeInput(req, res, next) {
  const invalidEmails = [];

  req.body = sanitizeContainer(req.body, invalidEmails);
  req.query = sanitizeContainer(req.query, invalidEmails);
  req.params = sanitizeContainer(req.params, invalidEmails);

  if (invalidEmails.length > 0) {
    return res.status(400).json({
      error: `Invalid email format in field(s): ${invalidEmails.join(', ')}`,
    });
  }

  return next();
}

module.exports = { sanitizeInput, SKIP_SANITIZE_KEYS };

