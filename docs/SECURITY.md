# Security Measures

This document summarizes the core backend security controls implemented in ShelterLink.

## 1) Parameterized SQL Queries

- All model-layer database operations use parameterized statements with `?` placeholders for variable values (via `pool.execute(sql, params)`).
- Direct string concatenation of user input into SQL is not used.
- Dynamic update/insert field construction is restricted with explicit allowlists:
  - `models/VolunteerProfile.js`: only approved profile fields are permitted.
  - `models/Opportunity.js`: only approved opportunity fields are permitted.
- Query review note:
  - A codebase search for backtick template literals in `pool.query(...)` calls found no matches.
  - Active DB calls use `pool.execute(...)` with parameter arrays.

## 2) Password Hashing (bcrypt)

- User passwords are hashed with `bcrypt` before storage (`SALT_ROUNDS = 10`).
- Authentication compares hashed passwords using `bcrypt.compare`.
- Plain-text passwords are not persisted.

## 3) Session Security Configuration

- Sessions use `express-session` with `httpOnly` cookies.
- In production (`NODE_ENV=production`):
  - `cookie.secure = true`
  - `cookie.sameSite = 'strict'`
- Session max age is configured to limit session lifetime.

## 4) Rate Limiting

- `express-rate-limit` is enabled with:
  - `loginLimiter`: 5 login attempts per 15 minutes per IP on `POST /api/auth/login`.
  - `apiLimiter`: 100 requests per 15 minutes per IP across `/api` routes.
- These controls reduce credential stuffing and abusive API traffic.

## 5) Input Sanitization

- Global sanitization middleware runs before route controllers.
- It sanitizes `req.body`, `req.query`, and `req.params` by:
  - trimming whitespace on all string values
  - escaping HTML with `xss`
  - validating `email` fields with `validator.isEmail`
- Invalid emails return HTTP 400.

## 6) Additional Security Headers and CORS

- `helmet()` is enabled to set common security headers (including CSP, HSTS, and frame protections).
- CORS is restricted to the configured frontend origin, with credentials enabled and methods limited to:
  - `GET`, `POST`, `PUT`, `DELETE`

