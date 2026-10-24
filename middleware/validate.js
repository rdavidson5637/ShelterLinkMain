'use strict';

const QUERY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const MAX_QUERY_VALUE = 2000;

function validationBody(fields) {
  return {
    error: 'Invalid request data.',
    fields,
  };
}

function zodFields(error) {
  const fields = {};
  for (const issue of error.issues || []) {
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      for (const key of issue.keys) {
        const path = issue.path.length ? `${issue.path.join('.')}.${key}` : key;
        if (!fields[path]) fields[path] = 'Unknown field';
      }
      continue;
    }
    const key = issue.path.length ? issue.path.join('.') : 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  if (!Object.keys(fields).length) fields.body = 'Invalid request data.';
  return fields;
}

function validateBody(schema) {
  return (req, res, next) => {
    const body =
      req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json(validationBody(zodFields(parsed.error)));
    }
    req.body = parsed.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json(validationBody(zodFields(parsed.error)));
    }
    req.query = parsed.data;
    return next();
  };
}

function positiveParam(name) {
  return (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(String(value))) {
      return res.status(400).json(validationBody({ [name]: 'Must be a positive integer' }));
    }
    return next();
  };
}

function boundedParam(name, max) {
  return (req, res, next, value) => {
    const text = String(value || '');
    if (!text || text.length > max || /[\u0000\r\n]/.test(text)) {
      return res.status(400).json(validationBody({ [name]: 'Invalid value' }));
    }
    return next();
  };
}

function boundQueryInput(req, res, next) {
  const fields = {};
  for (const [key, value] of Object.entries(req.query || {})) {
    if (!QUERY_KEY.test(key)) {
      fields[key] = 'Unknown field';
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 20) {
      fields[key] = 'Too many values';
      continue;
    }
    for (const item of values) {
      if (item != null && typeof item !== 'object' && String(item).length > MAX_QUERY_VALUE) {
        fields[key] = 'Too long';
      }
    }
  }
  if (Object.keys(fields).length) {
    return res.status(400).json(validationBody(fields));
  }
  return next();
}

module.exports = {
  validateBody,
  validateQuery,
  positiveParam,
  boundedParam,
  boundQueryInput,
  zodFields,
};
