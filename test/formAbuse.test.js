'use strict';

/**
 * SL-LATER-25 — abuse protection on public forms:
 * per-IP and per-email rate limits, honeypot fields, friendly 429 copy.
 * No paid captcha.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.NODE_ENV = 'test';

const {
  LIMITS,
  registerEmailLimiter,
  shelterApplyEmailLimiter,
} = require('../middleware/rateLimiter');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  // express-rate-limit v8 writes the message via send().
  res.send = (body) => {
    if (typeof body === 'string') {
      try {
        res.body = JSON.parse(body);
      } catch {
        res.body = { error: body };
      }
    } else {
      res.body = body;
    }
    return res;
  };
  res.setHeader = (name, value) => {
    res.headers[name] = value;
    return res;
  };
  res.getHeader = (name) => res.headers[name];
  return res;
}

test('register and shelter-apply email limiters cap the same address', async () => {
  const email = `abuse-${Date.now()}@example.test`;
  let registerAllowed = 0;
  let registerBlocked = 0;
  for (let i = 0; i < LIMITS.registerEmail + 1; i += 1) {
    const res = makeRes();
    let next = false;
    await registerEmailLimiter(
      { body: { email }, ip: '203.0.113.20' },
      res,
      () => {
        next = true;
      }
    );
    if (next) registerAllowed += 1;
    else {
      registerBlocked += 1;
      assert.equal(res.statusCode, 429);
      assert.match(String(res.body && res.body.error), /email/i);
    }
  }
  assert.equal(registerAllowed, LIMITS.registerEmail);
  assert.equal(registerBlocked, 1);

  let applyAllowed = 0;
  let applyBlocked = 0;
  for (let i = 0; i < LIMITS.shelterApplyEmail + 1; i += 1) {
    const res = makeRes();
    let next = false;
    await shelterApplyEmailLimiter(
      { body: { contact_email: email }, ip: '203.0.113.21' },
      res,
      () => {
        next = true;
      }
    );
    if (next) applyAllowed += 1;
    else {
      applyBlocked += 1;
      assert.equal(res.statusCode, 429);
      assert.match(String(res.body && res.body.error), /email/i);
    }
  }
  assert.equal(applyAllowed, LIMITS.shelterApplyEmail);
  assert.equal(applyBlocked, 1);
});

test('public forms ship a honeypot field and keep captcha out', () => {
  const registerHtml = fs.readFileSync(path.join(__dirname, '../frontend/register.html'), 'utf8');
  assert.match(registerHtml, /name="website"/);
  assert.match(registerHtml, /visually-hidden/);

  const applyHtml = fs.readFileSync(path.join(__dirname, '../frontend/apply.html'), 'utf8');
  assert.match(applyHtml, /name="website"/);

  const groupHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/group-booking.html'), 'utf8');
  assert.match(groupHtml, /name="fax_extension"/);

  const limiter = fs.readFileSync(path.join(__dirname, '../middleware/rateLimiter.js'), 'utf8');
  assert.doesNotMatch(limiter, /recaptcha|hcaptcha|turnstile|captcha/i);

  const authCtrl = fs.readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8');
  assert.match(authCtrl, /body\.website/);
});

test('group booking (public contact form) already wires IP and email limiters', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/groupBookings.js'), 'utf8');
  assert.match(route, /groupBookingLimiter/);
  assert.match(route, /groupBookingEmailLimiter/);
});

test('rate limit messages are JSON objects with friendly error copy', () => {
  const source = fs.readFileSync(path.join(__dirname, '../middleware/rateLimiter.js'), 'utf8');
  assert.match(source, /MSG\.register/);
  assert.match(source, /MSG\.registerEmail/);
  assert.match(source, /MSG\.shelterApply/);
  assert.match(source, /MSG\.shelterApplyEmail/);
  assert.match(source, /MSG\.groupBooking/);
  assert.match(source, /try again/i);
});
